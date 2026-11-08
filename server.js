/**
 * Magnata Brasil - Servidor autoritativo do jogo de tabuleiro multiplayer.
 *
 * Stack: Node.js + Express + Socket.io.
 * Toda a validacao de saldo, dados, aluguel, compra e regras ocorre no servidor.
 * O cliente apenas renderiza e anima os eventos recebidos.
 *
 * Este arquivo (FEAT-001) estabelece o scaffold do servidor e a camada completa
 * de dados do jogo: BOARD_SPACES (40 casas), CHANCE_CARDS (30 cartas de
 * "Acaso ou Destino"), COLOR_GROUPS, TURN_PHASE, a factory
 * createInitialGameState(playerCount) e a funcao auxiliar shuffle().
 *
 * Convencao de dinheiro: todos os valores sao guardados internamente em milhares
 * (k) como inteiros. Saldo inicial = 2558 (R$ 2.558.000). Um imovel de $100k = 100.
 *
 * Os manipuladores de lobby/conn/reconexao e o motor de turnos sao adicionados
 * pelos recursos subsequentes (FEAT-002/003/005). O servidor ja sobe e funciona.
 */

'use strict';

/* =========================================================================
 * TURN_PHASE - constantes da maquina de estados de turno do servidor
 * ========================================================================= */
const TURN_PHASE = Object.freeze({
  WAITING_ROLL: 'WAITING_ROLL',
  ANIMATING_MOVE: 'ANIMATING_MOVE',
  WAITING_BUY_DECISION: 'WAITING_BUY_DECISION',
  TURN_ACTIONS: 'TURN_ACTIONS',
  BANKRUPTCY_RESOLUTION: 'BANKRUPTCY_RESOLUTION'
});

/* =========================================================================
 * COLOR_GROUPS - mapeia cada cor do tabuleiro aos indices de suas casas.
 * Os transportes formam um grupo proprio (TRANS_PORTS) e usam multiplicador
 * de dados, nao dobragem por conjunto de cor.
 * ========================================================================= */
const COLOR_GROUPS = Object.freeze({
  Rosa: [1, 3, 4],
  'Azul Claro': [6, 8, 9],
  Roxo: [11, 13, 14],
  Laranja: [17, 19],
  Vermelho: [21, 23],
  Amarelo: [26, 28, 29],
  Verde: [31, 33, 34, 36],
  'Azul Escuro': [38, 39]
});

const TRANSPORT_GROUP = Object.freeze([5, 7, 15, 25, 32, 35]);

/* =========================================================================
 * BOARD_SPACES - as 40 casas exatas do tabuleiro de Magnata Brasil.
 * Valores em k. Cada imovel: mortgage = floor(price/2).
 *  - property: { index, name, type, color, price, rent[6], houseCost, mortgage }
 *  - transport: { index, name, type, icon, price, diceMult, mortgage }
 *  - go / chance / jail / bonus / freeparking / tax / gotojail: { index, name, type, icon, ... }
 * ========================================================================= */
const BOARD_SPACES = [
  { index: 0, name: 'Inicio da Jornada', type: 'go', icon: 'flag', pass: 200 },
  { index: 1, name: 'Praia do Arpoador', type: 'property', color: 'Rosa', price: 100, rent: [6, 30, 90, 270, 400, 500], houseCost: 50, mortgage: 50 },
  { index: 2, name: 'Acaso ou Destino', type: 'chance', icon: 'question' },
  { index: 3, name: 'Av. Central', type: 'property', color: 'Rosa', price: 60, rent: [2, 10, 30, 90, 160, 250], houseCost: 50, mortgage: 30 },
  { index: 4, name: 'Orla de Boa Viagem', type: 'property', color: 'Rosa', price: 60, rent: [4, 20, 60, 180, 320, 450], houseCost: 50, mortgage: 30 },
  { index: 5, name: 'Expresso Ferroviario Nacional', type: 'transport', icon: 'trem', price: 200, diceMult: 50, mortgage: 100 },
  { index: 6, name: 'Centro Financeiro Berrini', type: 'property', color: 'Azul Claro', price: 240, rent: [20, 100, 300, 750, 925, 1100], houseCost: 150, mortgage: 120 },
  { index: 7, name: 'Rede Rodoviaria Interestadual', type: 'transport', icon: 'onibus', price: 150, diceMult: 40, mortgage: 75 },
  { index: 8, name: 'Av. das Araucarias', type: 'property', color: 'Azul Claro', price: 220, rent: [18, 90, 250, 700, 875, 1050], houseCost: 150, mortgage: 110 },
  { index: 9, name: 'Tunel do Vale', type: 'property', color: 'Azul Claro', price: 220, rent: [18, 90, 250, 700, 875, 1050], houseCost: 150, mortgage: 110 },
  { index: 10, name: 'Delegacia', type: 'jail', icon: 'delegacia' },
  { index: 11, name: 'Alameda dos Jardins', type: 'property', color: 'Roxo', price: 200, rent: [16, 80, 220, 600, 800, 1000], houseCost: 100, mortgage: 100 },
  { index: 12, name: 'Acaso ou Destino', type: 'chance', icon: 'question' },
  { index: 13, name: 'Rua da Boemia', type: 'property', color: 'Roxo', price: 180, rent: [14, 70, 200, 550, 750, 950], houseCost: 100, mortgage: 90 },
  { index: 14, name: 'Colina do Estadio', type: 'property', color: 'Roxo', price: 180, rent: [14, 70, 200, 550, 750, 950], houseCost: 100, mortgage: 90 },
  { index: 15, name: 'Frota de Mobilidade Urbana', type: 'transport', icon: 'taxi', price: 150, diceMult: 40, mortgage: 75 },
  { index: 16, name: 'Acaso ou Destino', type: 'chance', icon: 'question' },
  { index: 17, name: 'Autodromo Internacional', type: 'property', color: 'Laranja', price: 350, rent: [35, 175, 500, 1100, 1300, 1500], houseCost: 200, mortgage: 175 },
  { index: 18, name: 'Rendimentos de Dividendos', type: 'bonus', icon: 'diamante', amount: 200 },
  { index: 19, name: 'Mansoes do Alto', type: 'property', color: 'Laranja', price: 400, rent: [50, 200, 600, 1400, 1700, 2000], houseCost: 200, mortgage: 200 },
  { index: 20, name: 'Estacionamento Livre', type: 'freeparking', icon: 'carro' },
  { index: 21, name: 'Aterro da Baia', type: 'property', color: 'Vermelho', price: 120, rent: [8, 40, 100, 300, 450, 600], houseCost: 50, mortgage: 60 },
  { index: 22, name: 'Acaso ou Destino', type: 'chance', icon: 'question' },
  { index: 23, name: 'Enseada dos Veleiros', type: 'property', color: 'Vermelho', price: 100, rent: [6, 30, 90, 270, 400, 500], houseCost: 50, mortgage: 50 },
  { index: 24, name: 'Auditoria Fiscal', type: 'tax', icon: 'balanca', amount: 200 },
  { index: 25, name: 'Porto Maritimo de Cargas', type: 'transport', icon: 'navio', price: 150, diceMult: 40, mortgage: 75 },
  { index: 26, name: 'Via Expressa Federal', type: 'property', color: 'Amarelo', price: 160, rent: [12, 60, 180, 500, 700, 900], houseCost: 100, mortgage: 80 },
  { index: 27, name: 'Acaso ou Destino', type: 'chance', icon: 'question' },
  { index: 28, name: 'Boulevard Financeiro', type: 'property', color: 'Amarelo', price: 140, rent: [10, 50, 150, 450, 625, 750], houseCost: 100, mortgage: 70 },
  { index: 29, name: 'Vila das Embaixadas', type: 'property', color: 'Amarelo', price: 140, rent: [10, 50, 150, 450, 625, 750], houseCost: 100, mortgage: 70 },
  { index: 30, name: 'Ordem de Detencao', type: 'gotojail', icon: 'sirene', target: 10 },
  { index: 31, name: 'Calcadao Imperial', type: 'property', color: 'Verde', price: 260, rent: [22, 110, 330, 800, 975, 1150], houseCost: 150, mortgage: 130 },
  { index: 32, name: 'Linhas Aereas Nacionais', type: 'transport', icon: 'aviao', price: 200, diceMult: 50, mortgage: 100 },
  { index: 33, name: 'Orla das Palmeiras', type: 'property', color: 'Verde', price: 320, rent: [28, 150, 450, 1000, 1200, 1400], houseCost: 200, mortgage: 160 },
  { index: 34, name: 'Avenida Oceanica', type: 'property', color: 'Verde', price: 300, rent: [26, 130, 390, 900, 1100, 1275], houseCost: 200, mortgage: 150 },
  { index: 35, name: 'Heliponto Executivo VIP', type: 'transport', icon: 'helicoptero', price: 200, diceMult: 50, mortgage: 100 },
  { index: 36, name: 'Mirante do Sol', type: 'property', color: 'Verde', price: 300, rent: [26, 130, 390, 900, 1100, 1275], houseCost: 200, mortgage: 150 },
  { index: 37, name: 'Acaso ou Destino', type: 'chance', icon: 'question' },
  { index: 38, name: 'Parque dos Ipes', type: 'property', color: 'Azul Escuro', price: 280, rent: [24, 120, 360, 850, 1025, 1200], houseCost: 150, mortgage: 140 },
  { index: 39, name: 'Distrito das Torres', type: 'property', color: 'Azul Escuro', price: 260, rent: [22, 110, 330, 800, 975, 1150], houseCost: 150, mortgage: 130 }
];

/* =========================================================================
 * CHANCE_CARDS - exatamente 30 cartas de "Acaso ou Destino".
 * Textos originais em portugues, sem marcas registradas. Valores em k.
 * kinds: getOutJailFree, advanceToGo, moveToJail, moveTo, goBack, gain, pay,
 *        gainFromEach, payRepair
 * ========================================================================= */
const CHANCE_CARDS = [
  { id: 1,  text: 'Habeas Corpus (Saida Livre) - Guarde esta carta e use-a para sair da Delegacia.', kind: 'getOutJailFree' },
  { id: 2,  text: 'Avance para o Inicio da Jornada e receba R$ 200k.', kind: 'advanceToGo' },
  { id: 3,  text: 'Va direto para a Delegacia, sem receber os R$ 200k.', kind: 'moveToJail' },
  { id: 4,  text: 'Avance para Rendimentos de Dividendos e receba o bonus do Banco.', kind: 'moveTo', target: 18 },
  { id: 5,  text: 'Volte 3 casas.', kind: 'goBack', spaces: 3 },
  { id: 6,  text: 'Receba R$ 50k de cada jogador pela venda de suas acoes.', kind: 'gainFromEach', amount: 50 },
  { id: 7,  text: 'Seu investimento em startups rendeu R$ 20k.', kind: 'gain', amount: 20 },
  { id: 8,  text: 'Reembolso de despesas corporativas: receba R$ 25k.', kind: 'gain', amount: 25 },
  { id: 9,  text: 'Distribuicao de lucros trimestrais: receba R$ 50k.', kind: 'gain', amount: 50 },
  { id: 10, text: 'Voce ganhou um premio de inovacao tecnologica: receba R$ 80k.', kind: 'gain', amount: 80 },
  { id: 11, text: 'Dividendos de suas empresas no exterior: receba R$ 100k.', kind: 'gain', amount: 100 },
  { id: 12, text: 'A venda de um terreno a beira-mar rendeu R$ 150k.', kind: 'gain', amount: 150 },
  { id: 13, text: 'Heranca inesperada de um parente distante: receba R$ 180k.', kind: 'gain', amount: 180 },
  { id: 14, text: 'Acordo publicitario de grande sucesso: receba R$ 200k.', kind: 'gain', amount: 200 },
  { id: 15, text: 'Pague R$ 15k de multa por excesso de velocidade.', kind: 'pay', amount: 15 },
  { id: 16, text: 'Multa de transito: pague R$ 25k ao Banco.', kind: 'pay', amount: 25 },
  { id: 17, text: 'Pague R$ 40k pela reforma do seu escritorio.', kind: 'pay', amount: 40 },
  { id: 18, text: 'Despesas medicas inesperadas: pague R$ 50k.', kind: 'pay', amount: 50 },
  { id: 19, text: 'Pague R$ 75k de imposto de renda atrasado.', kind: 'pay', amount: 75 },
  { id: 20, text: 'Doacao a instituicao de caridade: pague R$ 100k.', kind: 'pay', amount: 100 },
  { id: 21, text: 'Pague R$ 25k por casa e R$ 100k por hotel para a reforma geral dos imoveis.', kind: 'payRepair', perHouse: 25, perHotel: 100 },
  { id: 22, text: 'Reparos emergenciais: pague R$ 40k por casa e R$ 115k por hotel.', kind: 'payRepair', perHouse: 40, perHotel: 115 },
  { id: 23, text: 'Avance para o Expresso Ferroviario Nacional. Se passar pelo Inicio, receba R$ 200k.', kind: 'moveTo', target: 5 },
  { id: 24, text: 'Avance para a Praia do Arpoador. Se passar pelo Inicio, receba R$ 200k.', kind: 'moveTo', target: 1 },
  { id: 25, text: 'Seu livro virou best-seller nacional: receba R$ 60k.', kind: 'gain', amount: 60 },
  { id: 26, text: 'Pague R$ 30k pela matricula dos filhos na melhor escola.', kind: 'pay', amount: 30 },
  { id: 27, text: 'Avance para o Centro Financeiro Berrini. Se passar pelo Inicio, receba R$ 200k.', kind: 'moveTo', target: 6 },
  { id: 28, text: 'O lancamento do seu aplicativo foi um sucesso: receba R$ 120k.', kind: 'gain', amount: 120 },
  { id: 29, text: 'Despesas com viagem internacional: pague R$ 65k.', kind: 'pay', amount: 65 },
  { id: 30, text: 'Volte 2 casas.', kind: 'goBack', spaces: 2 }
];

/* =========================================================================
 * shuffle(array) - helper Fisher-Yates que retorna uma copia embaralhada.
 * Nao muta o array original (usado para montar o baralho de Acaso).
 * ========================================================================= */
function shuffle(array) {
  const out = Array.isArray(array) ? array.slice() : [];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/* =========================================================================
 * createInitialGameState(playerCount)
 * Fabrica do estado inicial de uma partida. Valores em k (saldo = 2558).
 * Os objetos de jogador aqui sao esqueletos; nickname/cor/conn sao anexados
 * pelos recursos de lobby (FEAT-002/003).
 * ========================================================================= */
function createPlayerSkeleton() {
  return {
    position: 0,
    balance: 2558,
    properties: {},            // map spaceIndex -> { houses: 0, hotel: false, mortgaged: false }
    getOutJailFreeCards: 0,
    inJail: false,
    jailTurns: 0,
    color: null,
    bankrupt: false
  };
}

function createInitialGameState(playerCount) {
  const count = Math.max(2, Math.min(6, parseInt(playerCount, 10) || 2));
  const players = [];
  for (let i = 0; i < count; i++) {
    players.push(createPlayerSkeleton());
  }
  return {
    players,
    currentPlayerIndex: 0,
    turnPhase: TURN_PHASE.WAITING_ROLL,
    dice: [1, 1],
    doublesCount: 0,
    chanceDeck: shuffle(CHANCE_CARDS),
    lastRoll: null,
    pendingDecision: null,
    log: []
  };
}

/* =========================================================================
 * Auto-verificacao (self-check).
 * `SELFTEST=1 node server.js` imprime "40 30" e sai sem abrir o servidor.
 * Deve vir antes do listen() para garantir saida limpa.
 * ========================================================================= */
if (require.main === module && process.env.SELFTEST) {
  console.log(BOARD_SPACES.length, CHANCE_CARDS.length);
  process.exit(0);
}

/* =========================================================================
 * Express + Socket.io bootstrap
 * Observacao: express e socket.io sao carregados APOS o self-check, de modo
 * que `SELFTEST=1 node server.js` funcione mesmo sem as dependencias instaladas
 * (o self-check roda apenas sobre a camada de dados pura, sem I/O de rede).
 * ========================================================================= */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.static('public'));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  /* cors e path usam os defaults do Socket.io (path /socket.io). */
});

/* Repositorios em memoria de salas e partidas (preenchidos pelo FEAT-002/003/005). */
const rooms = new Map();   // roomId -> { id, name, hostId, password, players: [], started }
const games = new Map();   // roomId -> gameState (createInitialGameState(...))

io.on('connection', (socket) => {
  // Manipuladores de lobby/conn/reconexao e motor de turnos sao adicionados
  // pelos recursos subsequentes (FEAT-002, FEAT-003, FEAT-005).
  socket.on('disconnect', () => {
    // A logica de remocao/reconexao e tratada no FEAT-002.
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Magnata Brasil servidor rodando em http://localhost:${PORT}`);
});

/* Exporta a camada de dados e helpers para uso/teste por outros modulos. */
module.exports = {
  TURN_PHASE,
  COLOR_GROUPS,
  TRANSPORT_GROUP,
  BOARD_SPACES,
  CHANCE_CARDS,
  shuffle,
  createInitialGameState,
  createPlayerSkeleton
};
