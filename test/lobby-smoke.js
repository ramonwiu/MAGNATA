/**
 * Magnata Brasil - smoke test do lobby (FEAT-002), host-based.
 *
 * Este sandbox esta em modo REPOSITORY-ACCESS-ONLY: o registry do npm e
 * bloqueado (HTTP 403), entao express e socket.io NAO estao instalados.
 * Para validar o servidor mesmo assim, instalamos um require-hook (Module._load)
 * que faz stub de 'express', 'socket.io' e http.createServer, de modo que
 * require('../server.js') carregue sem dependencias npm. O io falso captura o
 * callback de 'connection' e os sockets falsos registram os eventos emitidos,
 * permitindo assertar o fluxo completo de lobby/reconexao.
 *
 * Uso: `node test/lobby-smoke.js` (nao precisa do servidor rodando).
 */

'use strict';

const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

/* -------------------------------------------------------------------------
 * Fakes de Socket.io / Express / http.createServer
 * ------------------------------------------------------------------------- */

function makeFakeIO() {
  const connected = new Set();
  const emitRecords = []; // io.emit(...) -> broadcast para todos
  const toRecords = [];   // io.to(room).emit(...)
  const io = {
    connected,
    emitRecords,
    toRecords,
    _connectionCb: null,
    on(event, cb) {
      if (event === 'connection') this._connectionCb = cb;
      return this;
    },
    emit(event, ...args) {
      emitRecords.push({ event, args });
      for (const s of connected) s.emitted.push({ event, args });
      return this;
    },
    to(room) {
      const sender = this;
      return {
        emit(event, ...args) {
          toRecords.push({ room, event, args });
          for (const s of connected) {
            if (s.rooms.has(room)) s.emitted.push({ event, args });
          }
          return sender;
        }
      };
    },
    in(room) { return this.to(room); },
    socketsJoin(room) { for (const s of connected) s.rooms.add(room); },
    _connect(socket) {
      connected.add(socket);
      if (this._connectionCb) this._connectionCb(socket);
    }
  };
  return io;
}

function makeFakeSocket(id, io) {
  const handlers = {};
  const emitted = [];
  const rooms = new Set();
  const socket = {
    id,
    data: {},
    rooms,
    emitted,
    on(event, handler) { handlers[event] = handler; return socket; },
    once(event, handler) { handlers[event] = handler; return socket; },
    emit(event, ...args) { emitted.push({ event, args }); return socket; },
    join(room) { rooms.add(room); return Promise.resolve(); },
    leave(room) { rooms.delete(room); return Promise.resolve(); },
    to(room) {
      return {
        emit(event, ...args) {
          for (const s of io.connected) {
            if (s !== socket && s.rooms.has(room)) s.emitted.push({ event, args });
          }
          return socket;
        }
      };
    },
    broadcast: {
      emit(event, ...args) {
        for (const s of io.connected) {
          if (s !== socket) s.emitted.push({ event, args });
        }
        return socket;
      }
    },
    _fire(event, ...args) {
      if (handlers[event]) handlers[event](...args);
    },
    _disconnect() {
      io.connected.delete(socket);
      if (handlers['disconnect']) handlers['disconnect']();
    }
  };
  return socket;
}

function makeExpressStub() {
  function express() {
    return { use: () => {}, get: () => {}, post: () => {}, listen: () => {}, set: () => {} };
  }
  express.static = () => (req, res, next) => { if (next) next(); };
  return express;
}

const socketIOStub = { Server: function ServerStub() { return makeFakeIO(); } };

/* -------------------------------------------------------------------------
 * Require-hook: stub de express, socket.io e http.createServer.
 * ------------------------------------------------------------------------- */
Module._load = function (request, parent, isMain) {
  if (request === 'express') return makeExpressStub();
  if (request === 'socket.io') return socketIOStub;
  if (request === 'http') {
    const realHttp = originalLoad.call(this, request, parent, isMain);
    return Object.assign(Object.create(realHttp), {
      createServer: () => ({ listen: () => ({}) })
    });
  }
  return originalLoad.call(this, request, parent, isMain);
};

/* -------------------------------------------------------------------------
 * Assertions
 * ------------------------------------------------------------------------- */
let passed = 0;
function check(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
  passed++;
}
function lastEmit(socket, event) {
  for (let i = socket.emitted.length - 1; i >= 0; i--) {
    if (socket.emitted[i].event === event) return socket.emitted[i];
  }
  return null;
}
function findEmit(socket, event) {
  return socket.emitted.find((e) => e.event === event) || null;
}

/* -------------------------------------------------------------------------
 * Carrega o servidor sob os stubs.
 * ------------------------------------------------------------------------- */
const serverPath = path.resolve(__dirname, '..', 'server.js');
delete require.cache[serverPath];
const server = require('../server.js');
const io = server.io;

function newClient(label) {
  const s = makeFakeSocket(label, io);
  io._connect(s);
  return s;
}

/* =========================================================================
 * Cenario principal: criar sala privada, validar senha, cor, inicio, reconexao
 * ========================================================================= */
function mainScenario() {
  const alice = newClient('sock-alice'); // host
  const bob = newClient('sock-bob');

  // 1) Alice cria sala privada com senha.
  alice._fire('createRoom', {
    roomName: 'Sala Secreta',
    password: 'segredo',
    nickname: 'Alice',
    sessionId: 'sid-alice'
  });
  const joinedAlice = findEmit(alice, 'joinedRoom');
  check(joinedAlice, 'host recebeu joinedRoom');
  check(joinedAlice.args[0].roomId, 'joinedRoom traz roomId');
  check(joinedAlice.args[0].playerId === 'sid-alice', 'host playerId = sessionId');
  check(!('password' in (joinedAlice.args[0].room || {})), 'joinedRoom NAO inclui password');
  const roomId = joinedAlice.args[0].roomId;

  // 2) roomsListUpdate publica: hasPassword true e SEM campo password.
  const listEv = io.emitRecords.find((e) => e.event === 'roomsListUpdate');
  check(listEv, 'roomsListUpdate foi broadcastado (io.emit)');
  const roomEntry = listEv.args[0].find((r) => r.roomId === roomId);
  check(roomEntry, 'sala aparece na lista publica');
  check(roomEntry.hasPassword === true, 'hasPassword === true para sala privada');
  check(!('password' in roomEntry), 'roomsListUpdate NAO contem password');
  check(roomEntry.status === 'lobby', 'status lobby');
  check(roomEntry.playerCount === 1, 'playerCount 1');

  // 3) Iniciar com 1 jogador deve falhar (>=2 jogadores).
  alice._fire('startGame', {});
  const needTwo = lastEmit(alice, 'error');
  check(needTwo && /2 jogadores/i.test(needTwo.args[0].message), 'startGame com <2 jogadores falha');

  // 4) Bob tenta entrar com senha errada -> erro e NAO entra.
  bob._fire('joinRoom', { roomId, password: 'errada', nickname: 'Bob', sessionId: 'sid-bob' });
  const wrong = lastEmit(bob, 'error');
  check(wrong && /incorreta/i.test(wrong.args[0].message), 'senha errada -> "Senha incorreta!"');
  check(!server.socketToRoom.has('sock-bob'), 'socket do bob nao registrado (senha errada)');
  check(!server.rooms.get(roomId).players.has('sid-bob'), 'bob nao foi adicionado (senha errada)');
  check(server.rooms.get(roomId).players.size === 1, 'sala segue com 1 jogador');

  // 5) Bob entra com a senha correta.
  bob._fire('joinRoom', { roomId, password: 'segredo', nickname: 'Bob', sessionId: 'sid-bob' });
  const joinedBob = findEmit(bob, 'joinedRoom');
  check(joinedBob && joinedBob.args[0].playerId === 'sid-bob', 'bob entrou com senha correta');
  check(server.rooms.get(roomId).players.size === 2, 'sala agora tem 2 jogadores');
  check(server.socketToRoom.has('sock-bob'), 'socket do bob registrado');
  // Alice tambem recebeu roomState atualizada (via io.to(roomId).emit).
  check(alice.emitted.some((e) => e.event === 'roomState'), 'alice recebeu roomState');

  // 6) startGame por nao-host deve falhar.
  bob._fire('startGame', {});
  const hostOnly = lastEmit(bob, 'error');
  check(hostOnly && /anfitriao/i.test(hostOnly.args[0].message), 'apenas o anfitriao inicia a partida');

  // 7) Selecao de cor: Alice pega Vermelho; Bob tenta Vermelho (bloqueada) e pega Azul.
  alice._fire('selectColor', { color: 'Vermelho' });
  check(server.rooms.get(roomId).players.get('sid-alice').color === 'Vermelho', 'alice = Vermelho');
  bob._fire('selectColor', { color: 'Vermelho' });
  const colorErr = lastEmit(bob, 'error');
  check(colorErr && /cor/i.test(colorErr.args[0].message), 'cor ja escolhida e bloqueada');
  check(server.rooms.get(roomId).players.get('sid-bob').color !== 'Vermelho', 'bob nao pegou Vermelho');
  bob._fire('selectColor', { color: 'Azul' });
  check(server.rooms.get(roomId).players.get('sid-bob').color === 'Azul', 'bob = Azul');

  // 8) Host inicia a partida (2 jogadores) -> status playing + gameState.
  alice._fire('startGame', {});
  check(server.rooms.get(roomId).status === 'playing', 'status passou para playing');
  check(findEmit(alice, 'gameState'), 'alice recebeu gameState');
  check(findEmit(bob, 'gameState'), 'bob recebeu gameState');
  const gsState = findEmit(alice, 'gameState').args[0];
  check(gsState.turnPhase === server.TURN_PHASE.WAITING_ROLL, 'turnPhase WAITING_ROLL');
  check(gsState.currentPlayerIndex === 0, 'currentPlayerIndex 0');
  check(gsState.players.length === 2, 'gameState com 2 jogadores');
  check(gsState.players[0].balance === 2558, 'saldo inicial 2558');
  check(gsState.players[0].color === 'Vermelho', 'cor ligada ao gameState');
  check(!('password' in gsState), 'gameState sem password');
  // roomsListUpdate agora reflete status playing.
  const playingList = io.emitRecords.filter((e) => e.event === 'roomsListUpdate').pop();
  check(playingList.args[0].find((r) => r.roomId === roomId).status === 'playing', 'lista publica reflete playing');
  const gameRef = server.games.get(roomId);

  // 9) Reconexao por sessionId: Alice desconecta (em partida -> estado preservado).
  alice._disconnect();
  const roomAfter = server.rooms.get(roomId);
  check(roomAfter.players.has('sid-alice'), 'alice mantida apos disconnect (playing)');
  check(roomAfter.players.get('sid-alice').connected === false, 'alice marcada desconectada');
  check(server.games.get(roomId) === gameRef, 'gameState NAO foi recriado (turno preservado)');
  check(server.games.get(roomId).currentPlayerIndex === 0, 'turno nao resetado');

  // 10) Alice volta com novo socket, mesmo sessionId -> reconecta (ignora senha).
  const alice2 = newClient('sock-alice2');
  alice2._fire('joinRoom', { roomId, password: 'errada', nickname: 'Alice', sessionId: 'sid-alice' });
  const rejoined = findEmit(alice2, 'joinedRoom');
  check(rejoined && rejoined.args[0].playerId === 'sid-alice', 'alice reconectou pelo sessionId');
  check(server.rooms.get(roomId).players.get('sid-alice').connected === true, 'alice reconectada (connected true)');
  check(server.rooms.get(roomId).players.size === 2, 'sem duplicar jogador (ainda 2)');
  check(server.socketToRoom.has('sock-alice2'), 'novo socket registrado');
  const gp = server.games.get(roomId).players.find((p) => p.id === 'sid-alice');
  check(gp && gp.balance === 2558, 'saldo preservado na reconexao');
  check(gp && gp.color === 'Vermelho', 'cor preservada na reconexao');
  check(server.games.get(roomId) === gameRef, 'gameState segue o mesmo apos reconexao');
}

/* =========================================================================
 * Cenario sala cheia: >6 jogadores rejeitado
 * ========================================================================= */
function fullRoomScenario() {
  const host = newClient('full-host');
  host._fire('createRoom', { roomName: 'Sala Cheia', password: '', nickname: 'H', sessionId: 'h-full' });
  const fullRoomId = findEmit(host, 'joinedRoom').args[0].roomId;
  for (let k = 1; k <= 5; k++) {
    const sk = newClient('full-' + k);
    sk._fire('joinRoom', { roomId: fullRoomId, password: '', nickname: 'J' + k, sessionId: 'j-full-' + k });
    check(findEmit(sk, 'joinedRoom'), 'joiner ' + k + ' entrou');
  }
  check(server.rooms.get(fullRoomId).players.size === 6, 'sala cheia tem 6 jogadores');
  const overflow = newClient('full-7');
  overflow._fire('joinRoom', { roomId: fullRoomId, password: '', nickname: 'J7', sessionId: 'j-full-7' });
  const ovErr = lastEmit(overflow, 'error');
  check(ovErr && /lotada/i.test(ovErr.args[0].message), '7o jogador rejeitado (sala lotada)');
  check(!server.socketToRoom.has('full-7'), 'overflow nao registrado');
  check(server.rooms.get(fullRoomId).players.size === 6, 'sala segue com 6');
}

/* =========================================================================
 * Cenario getRooms: cliente fresco recebe a lista
 * ========================================================================= */
function getRoomsScenario() {
  const fresh = newClient('fresh-getrooms');
  fresh._fire('getRooms');
  const grList = lastEmit(fresh, 'roomsListUpdate');
  check(grList, 'getRooms respondeu roomsListUpdate');
  check(Array.isArray(grList.args[0]), 'payload de roomsListUpdate e um array');
  // Nenhuma sala na lista expoe password.
  for (const r of grList.args[0]) {
    check(!('password' in r), 'nenhuma sala expoe password em getRooms');
  }
}

/* =========================================================================
 * Cenario setNickname: valida nickname vazio
 * ========================================================================= */
function setNicknameScenario() {
  const s = newClient('nick-socket');
  s._fire('setNickname', { nickname: '  ', sessionId: 'sid-nick' });
  check(lastEmit(s, 'error') && /nickname/i.test(lastEmit(s, 'error').args[0].message), 'nickname vazio rejeitado');
  s._fire('setNickname', { nickname: 'Magnata', sessionId: 'sid-nick' });
  check(s.data.nickname === 'Magnata', 'nickname armazenado no socket.data');
  check(s.data.sessionId === 'sid-nick', 'sessionId armazenado no socket.data');
}

/* =========================================================================
 * Cenario lobby disconnect: remove jogador e reatribui host
 * ========================================================================= */
function lobbyDisconnectScenario() {
  const h = newClient('ld-host');
  h._fire('createRoom', { roomName: 'Sala Lobby', password: '', nickname: 'HostL', sessionId: 'ld-h' });
  const rid = findEmit(h, 'joinedRoom').args[0].roomId;
  const g = newClient('ld-guest');
  g._fire('joinRoom', { roomId: rid, password: '', nickname: 'GuestL', sessionId: 'ld-g' });
  check(server.rooms.get(rid).hostPlayerId === 'ld-h', 'host inicial = criador');
  // Host sai (lobby) -> host reatribuido ao convidado.
  h._disconnect();
  check(!server.rooms.get(rid).players.has('ld-h'), 'host removido do lobby ao desconectar');
  check(server.rooms.get(rid).hostPlayerId === 'ld-g', 'host reatribuido ao convidado');
  // Ultimo jogador sai -> sala removida.
  g._disconnect();
  check(!server.rooms.has(rid), 'sala vazia e removida do lobby');
}

/* -------------------------------------------------------------------------
 * Execucao
 * ------------------------------------------------------------------------- */
try {
  mainScenario();
  fullRoomScenario();
  getRoomsScenario();
  setNicknameScenario();
  lobbyDisconnectScenario();
  console.log('PASS: all lobby smoke assertions (' + passed + ')');
} catch (e) {
  console.error('FAIL: ' + e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
} finally {
  Module._load = originalLoad;
}
