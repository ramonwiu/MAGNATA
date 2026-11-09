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

/* =========================================================================
 * Repositorios em memoria de salas e partidas (FEAT-002 em diante).
 * Salas (rooms): roomId -> room. Partidas (games): roomId -> gameState.
 * socketToRoom: indice reverso socketId -> { roomId, playerId } para lookup
 * rapido em disconnect/leaveRoom.
 * ========================================================================= */
const MAX_PLAYERS = 6;
const ALLOWED_COLORS = ['Vermelho', 'Azul', 'Verde', 'Amarelo', 'Roxo', 'Laranja'];

const rooms = new Map();       // roomId -> room
const games = new Map();       // roomId -> gameState (createInitialGameState + jogadores ligados)
const socketToRoom = new Map(); // socketId -> { roomId, playerId }

/* -------------------------------------------------------------------------
 * Helpers de sala / estado sanitizado.
 *
 * SEGURANCA: o estado enviado ao cliente (joinedRoom/roomState/gameState e
 * roomsListUpdate) NUNCA inclui a senha da sala. Apenas o booleano
 * hasPassword e exposto em roomsListUpdate; a string da senha e validada
 * exclusivamente no servidor, dentro do handler joinRoom.
 *
 * Formato de uma sala:
 *   { id, name, password (''|string), hostPlayerId, players: Map<playerId, player>,
 *     maxPlayers, status: 'lobby'|'playing' }
 * Formato de um jogador (na sala - somente identidade/lobby):
 *   { id (sessionId), nickname, socketId, color, connected, lastSeen }
 * O estado de jogo (saldo, posicao, propriedades, prisao, etc.) vive no
 * gameState (games Map) e e mesclado na visao sanitizada quando status==='playing'.
 * ------------------------------------------------------------------------- */
function getHostNickname(room) {
  if (!room) return '';
  const host = room.players.get(room.hostPlayerId);
  return host ? host.nickname : '';
}

function isColorTaken(room, color, exceptPlayerId) {
  if (!room) return false;
  for (const [pid, p] of room.players) {
    if (pid === exceptPlayerId) continue;
    if (p.color === color) return true;
  }
  return false;
}

function genRoomId() {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  } while (rooms.has(id));
  return id;
}

// Resolve nickname + sessionId a partir do payload do evento e/ou socket.data.
function resolveIdentity(socket, payload) {
  const p = payload || {};
  const data = socket.data || {};
  let nickname = '';
  if (p.nickname != null) nickname = String(p.nickname).trim();
  else if (data.nickname != null) nickname = String(data.nickname).trim();
  let sessionId = '';
  if (p.sessionId != null) sessionId = String(p.sessionId);
  else if (data.sessionId != null) sessionId = String(data.sessionId);
  if (!sessionId) sessionId = socket.id;
  return { nickname, sessionId };
}

// Estado sanitizado enviado em joinedRoom/roomState/gameState. Sem senha.
function sanitizeRoomState(room) {
  const game = room ? games.get(room.id) : null;
  const players = [];
  if (room) {
    for (const [pid, p] of room.players) {
      const gp = game ? game.players.find((x) => x.id === pid) : null;
      players.push({
        id: p.id,
        nickname: p.nickname,
        color: p.color,
        balance: gp ? gp.balance : 2558,
        position: gp ? gp.position : 0,
        bankrupt: gp ? gp.bankrupt : false,
        inJail: gp ? gp.inJail : false,
        connected: p.connected,
        properties: gp ? gp.properties : {},
        getOutJailFreeCards: gp ? gp.getOutJailFreeCards : 0
      });
    }
  }
  const ownership = {};
  if (game) {
    for (const gp of game.players) {
      const props = gp.properties || {};
      for (const spaceIndex of Object.keys(props)) {
        ownership[spaceIndex] = gp.id;
      }
    }
  }
  return {
    roomId: room ? room.id : null,
    name: room ? room.name : '',
    hostNickname: getHostNickname(room),
    status: room ? room.status : 'lobby',
    players,
    currentPlayerIndex: game ? game.currentPlayerIndex : 0,
    turnPhase: game ? game.turnPhase : null,
    dice: game ? game.dice : [1, 1],
    lastRoll: game ? game.lastRoll : null,
    doublesCount: game ? game.doublesCount : 0,
    pendingDecision: game ? game.pendingDecision : null,
    ownership,
    log: game ? (game.log || []) : []
  };
}

// Lista publica de salas (roomsListUpdate). Sem senha - apenas hasPassword.
function buildRoomsList() {
  const list = [];
  for (const r of rooms.values()) {
    list.push({
      roomId: r.id,
      roomName: r.name,
      hostNickname: getHostNickname(r),
      playerCount: r.players.size,
      maxPlayers: r.maxPlayers,
      status: r.status,
      hasPassword: r.password !== ''
    });
  }
  return list;
}

function broadcastRoomsList() {
  io.emit('roomsListUpdate', buildRoomsList());
}

io.on('connection', (socket) => {
  /* ---- Identificacao (nickname + sessionId persistido no cliente) ---- */
  socket.on('setNickname', (payload) => {
    const p = payload || {};
    const nickname = (p.nickname != null ? String(p.nickname) : '').trim();
    if (!nickname) {
      socket.emit('error', { message: 'Nickname obrigatorio.' });
      return;
    }
    const sessionId = (p.sessionId != null ? String(p.sessionId) : '') || socket.id;
    socket.data = socket.data || {};
    socket.data.nickname = nickname;
    socket.data.sessionId = sessionId;
  });

  /* ---- Criacao de sala ---- */
  socket.on('createRoom', (payload) => {
    const p = payload || {};
    const roomName = (p.roomName != null ? String(p.roomName) : '').trim();
    if (!roomName) {
      socket.emit('error', { message: 'Nome da sala e obrigatorio.' });
      return;
    }
    const { nickname, sessionId } = resolveIdentity(socket, p);
    if (!nickname) {
      socket.emit('error', { message: 'Nickname obrigatorio.' });
      return;
    }
    for (const r of rooms.values()) {
      if (r.name.toLowerCase() === roomName.toLowerCase()) {
        socket.emit('error', { message: 'Ja existe uma sala com esse nome.' });
        return;
      }
    }
    if (socketToRoom.has(socket.id)) {
      socket.emit('error', { message: 'Voce ja esta em uma sala.' });
      return;
    }
    const roomId = genRoomId();
    const playerId = sessionId;
    const room = {
      id: roomId,
      name: roomName,
      password: p.password != null ? String(p.password) : '',
      hostPlayerId: playerId,
      players: new Map(),
      maxPlayers: MAX_PLAYERS,
      status: 'lobby'
    };
    const player = {
      id: playerId,
      nickname,
      socketId: socket.id,
      color: null,
      connected: true,
      lastSeen: Date.now()
    };
    room.players.set(playerId, player);
    rooms.set(roomId, room);
    socketToRoom.set(socket.id, { roomId, playerId });
    socket.join(roomId);
    socket.emit('joinedRoom', { roomId, playerId, room: sanitizeRoomState(room) });
    broadcastRoomsList();
  });

  /* ---- Entrada em sala (senha validada no servidor) / reconexao ---- */
  socket.on('joinRoom', (payload) => {
    const p = payload || {};
    const roomId = p.roomId != null ? String(p.roomId) : '';
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Sala nao encontrada' });
      return;
    }
    const { nickname, sessionId } = resolveIdentity(socket, p);
    if (!nickname) {
      socket.emit('error', { message: 'Nickname obrigatorio.' });
      return;
    }
    // Reconexao: jogador ja existente na sala (mesmo sessionId) ignora a senha.
    const existing = room.players.get(sessionId);
    if (existing) {
      existing.socketId = socket.id;
      existing.connected = true;
      existing.lastSeen = Date.now();
      if (nickname) existing.nickname = nickname;
      socketToRoom.set(socket.id, { roomId, playerId: existing.id });
      socket.join(roomId);
      socket.emit('joinedRoom', { roomId, playerId: existing.id, room: sanitizeRoomState(room) });
      io.to(roomId).emit('roomState', sanitizeRoomState(room));
      broadcastRoomsList();
      return;
    }
    // Novo membro: valida senha no servidor (critico para seguranca).
    if (room.password !== '' && (p.password != null ? String(p.password) : '') !== room.password) {
      socket.emit('error', { message: 'Senha incorreta!' });
      return;
    }
    if (room.players.size >= room.maxPlayers) {
      socket.emit('error', { message: 'Sala lotada' });
      return;
    }
    if (socketToRoom.has(socket.id)) {
      socket.emit('error', { message: 'Voce ja esta em uma sala.' });
      return;
    }
    const playerId = sessionId;
    let color = null;
    if (p.color != null) {
      const c = String(p.color);
      if (ALLOWED_COLORS.includes(c) && !isColorTaken(room, c, null)) color = c;
    }
    const player = {
      id: playerId,
      nickname,
      socketId: socket.id,
      color,
      connected: true,
      lastSeen: Date.now()
    };
    room.players.set(playerId, player);
    socketToRoom.set(socket.id, { roomId, playerId });
    socket.join(roomId);
    socket.emit('joinedRoom', { roomId, playerId, room: sanitizeRoomState(room) });
    io.to(roomId).emit('roomState', sanitizeRoomState(room));
    broadcastRoomsList();
  });

  /* ---- Selecao de cor do peao ---- */
  socket.on('selectColor', (payload) => {
    const reg = socketToRoom.get(socket.id);
    if (!reg) {
      socket.emit('error', { message: 'Voce nao esta em uma sala.' });
      return;
    }
    const room = rooms.get(reg.roomId);
    if (!room) return;
    const player = room.players.get(reg.playerId);
    if (!player) return;
    const color = payload && payload.color != null ? String(payload.color) : '';
    if (!ALLOWED_COLORS.includes(color)) {
      socket.emit('error', { message: 'Cor invalida.' });
      return;
    }
    if (isColorTaken(room, color, player.id)) {
      socket.emit('error', { message: 'Cor ja escolhida por outro jogador.' });
      return;
    }
    player.color = color;
    io.to(room.id).emit('roomState', sanitizeRoomState(room));
  });

  /* ---- Inicio de partida (apenas anfitriao, >=2 jogadores) ---- */
  socket.on('startGame', () => {
    const reg = socketToRoom.get(socket.id);
    if (!reg) {
      socket.emit('error', { message: 'Voce nao esta em uma sala.' });
      return;
    }
    const room = rooms.get(reg.roomId);
    if (!room) return;
    if (room.hostPlayerId !== reg.playerId) {
      socket.emit('error', { message: 'Apenas o anfitriao pode iniciar a partida.' });
      return;
    }
    if (room.players.size < 2) {
      socket.emit('error', { message: 'Sao necessarios pelo menos 2 jogadores.' });
      return;
    }
    if (room.status === 'playing') {
      socket.emit('error', { message: 'A partida ja comecou.' });
      return;
    }
    const count = room.players.size;
    const gs = createInitialGameState(count);
    let i = 0;
    for (const [pid, p] of room.players) {
      const gp = gs.players[i];
      gp.id = p.id;
      gp.nickname = p.nickname;
      gp.color = p.color;
      gp.connected = p.connected;
      gp.balance = 2558;
      gp.position = 0;
      gp.properties = {};
      gp.getOutJailFreeCards = 0;
      gp.inJail = false;
      gp.jailTurns = 0;
      gp.bankrupt = false;
      i++;
    }
    games.set(room.id, gs);
    room.status = 'playing';
    broadcastRoomsList();
    io.to(room.id).emit('gameState', sanitizeRoomState(room));
  });

  /* ---- Saida voluntaria da sala ---- */
  socket.on('leaveRoom', () => {
    const reg = socketToRoom.get(socket.id);
    if (!reg) {
      socket.emit('error', { message: 'Voce nao esta em uma sala.' });
      return;
    }
    const room = rooms.get(reg.roomId);
    socketToRoom.delete(socket.id);
    socket.leave(reg.roomId);
    if (room) {
      const player = room.players.get(reg.playerId);
      if (room.status === 'lobby') {
        room.players.delete(reg.playerId);
        if (room.hostPlayerId === reg.playerId) {
          const next = room.players.keys().next().value;
          if (next) room.hostPlayerId = next;
        }
        if (room.players.size === 0) {
          rooms.delete(room.id);
          games.delete(room.id);
          broadcastRoomsList();
          socket.emit('leftRoom', { ok: true });
          return;
        }
        io.to(room.id).emit('roomState', sanitizeRoomState(room));
        broadcastRoomsList();
      } else if (player) {
        player.connected = false;
        io.to(room.id).emit('roomState', sanitizeRoomState(room));
        broadcastRoomsList();
      }
    }
    socket.emit('leftRoom', { ok: true });
  });

  /* ---- Lista de salas para clientes recem-conectados ---- */
  socket.on('getRooms', () => {
    socket.emit('roomsListUpdate', buildRoomsList());
  });

  /* ---- Desconexao ---- */
  socket.on('disconnect', () => {
    const reg = socketToRoom.get(socket.id);
    if (!reg) return;
    socketToRoom.delete(socket.id);
    const room = rooms.get(reg.roomId);
    if (!room) return;
    const player = room.players.get(reg.playerId);
    if (!player) return;
    if (room.status === 'lobby') {
      // No lobby: remove o jogador; reatribui host ou fecha a sala se vazia.
      room.players.delete(reg.playerId);
      if (room.hostPlayerId === reg.playerId) {
        const next = room.players.keys().next().value;
        if (next) room.hostPlayerId = next;
      }
      if (room.players.size === 0) {
        rooms.delete(room.id);
        games.delete(room.id);
        broadcastRoomsList();
        return;
      }
      io.to(room.id).emit('roomState', sanitizeRoomState(room));
      broadcastRoomsList();
    } else {
      // Em partida: mantem o estado do jogador para reconexao (nao remove).
      player.connected = false;
      player.lastSeen = Date.now();
      io.to(room.id).emit('roomState', sanitizeRoomState(room));
      broadcastRoomsList();
    }
  });

  /* ----------------------------------------------------------------------
   * FEAT-003 implementara o motor de turnos (rollDice, buyDecision, build,
   * mortgage, trade, jail, etc.). Nada aqui lanca (throw) -- o servidor
   * continua funcionando e o lobby esta completo apos FEAT-002.
   * ---------------------------------------------------------------------- */
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Magnata Brasil servidor rodando em http://localhost:${PORT}`);
});

/* Exporta a camada de dados, helpers e a fachada io/rooms/games para uso/teste
 * por outros modulos (incluindo o smoke test com stubs de FEAT-002). */
module.exports = {
  TURN_PHASE,
  COLOR_GROUPS,
  TRANSPORT_GROUP,
  BOARD_SPACES,
  CHANCE_CARDS,
  shuffle,
  createInitialGameState,
  createPlayerSkeleton,
  // FEAT-002: lobby / reconn
  ALLOWED_COLORS,
  MAX_PLAYERS,
  io,
  rooms,
  games,
  socketToRoom,
  sanitizeRoomState,
  buildRoomsList,
  getHostNickname,
  isColorTaken,
  resolveIdentity
};
