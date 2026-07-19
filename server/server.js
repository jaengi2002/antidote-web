const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { RoomManager } = require('./game/roomManager');

const PORT = process.env.PORT || 4000;
const app = express();
app.use(cors());
app.use(express.json());

const rooms = new RoomManager();

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.rooms.size, ruleset: 'antidote-official-v1' });
});

const clientDist = path.join(__dirname, '..', 'client', 'dist');
const hasClient = fs.existsSync(clientDist);

if (hasClient) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io') || req.path === '/health') return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text').send('Antidote server OK. Build the client for production UI.');
  });
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 20000,
  pingInterval: 10000,
});

setInterval(() => rooms.cleanupIdleRooms(), 10 * 60 * 1000);

function emitViews(room) {
  if (!room) return;
  for (const playerId of room.order) {
    const p = room.players[playerId];
    if (!p?.socketId || !p.connected) continue;
    const view = rooms.viewForPlayer(room, playerId);
    if (view) io.to(p.socketId).emit('gameState', view);
  }
  // spectators
  for (const sid of Object.keys(room.spectators || {})) {
    const s = room.spectators[sid];
    if (!s?.socketId || !s.connected) continue;
    const view = rooms.viewForPlayer(room, sid);
    if (view) io.to(s.socketId).emit('gameState', view);
  }
}

function replySession(socket, result, cb) {
  if (result.error) {
    if (typeof cb === 'function') cb({ ok: false, error: result.error });
    return;
  }
  socket.join(result.room.code);
  const view = rooms.viewForPlayer(result.room, result.playerId);
  if (typeof cb === 'function') {
    cb({
      ok: true,
      state: view,
      sessionToken: result.sessionToken,
      playerId: result.playerId,
      roomCode: result.room.code,
    });
  }
  emitViews(result.room);
}

function runBotsAndEmit(room) {
  if (!room) return;
  let guard = 0;
  while (guard < 8) {
    guard += 1;
    const acted = rooms.runBots(room);
    if (!acted) break;
  }
  emitViews(room);
}

function act(socket, fn, cb) {
  try {
    const result = fn();
    if (result.error) {
      if (typeof cb === 'function') cb({ ok: false, error: result.error });
      return;
    }
    if (typeof cb === 'function') cb({ ok: true });
    emitViews(result.room);
    // bots act after short delay so humans see intermediate state
    if (result.room) {
      setTimeout(() => runBotsAndEmit(result.room), 350);
    }
  } catch (e) {
    if (typeof cb === 'function') cb({ ok: false, error: e.message });
  }
}

io.on('connection', (socket) => {
  console.log('connected', socket.id);

  socket.on('createRoom', ({ name }, cb) => {
    try {
      replySession(socket, rooms.createRoom(socket.id, name), cb);
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  socket.on('joinRoom', ({ code, name }, cb) => {
    try {
      replySession(socket, rooms.joinRoom(socket.id, code, name), cb);
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  socket.on('reconnectSession', ({ sessionToken }, cb) => {
    try {
      replySession(socket, rooms.reconnect(socket.id, sessionToken), cb);
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  socket.on('leaveRoom', (cb) => {
    const result = rooms.leaveExplicit(socket.id);
    if (typeof cb === 'function') cb({ ok: true });
    if (result?.room) emitViews(result.room);
  });

  socket.on('startGame', (cb) => act(socket, () => rooms.startGame(socket.id), cb));
  socket.on('setExpansions', (payload, cb) =>
    act(socket, () => rooms.setExpansions(socket.id, payload || {}), cb)
  );
  socket.on('addBot', (cb) => act(socket, () => rooms.addBot(socket.id), cb));
  socket.on('nextRound', (cb) => act(socket, () => rooms.nextRound(socket.id), cb));

  // Official actions
  socket.on('beginMassDiscard', (cb) => act(socket, () => rooms.beginMassDiscard(socket.id), cb));
  socket.on('beginMassPass', ({ direction }, cb) =>
    act(socket, () => rooms.beginMassPass(socket.id, direction), cb)
  );
  socket.on('selectPendingCard', ({ cardId }, cb) =>
    act(socket, () => rooms.selectPendingCard(socket.id, cardId), cb)
  );
  socket.on('clinicalChooseDirection', ({ direction }, cb) =>
    act(socket, () => rooms.clinicalChooseDirection(socket.id, direction), cb)
  );
  socket.on('clinicalPickCard', ({ workstationIndex }, cb) =>
    act(socket, () => rooms.clinicalPickCard(socket.id, workstationIndex), cb)
  );
  socket.on('placeboSwap', (payload, cb) =>
    act(socket, () => rooms.placeboSwap(socket.id, payload || {}), cb)
  );
  socket.on('drawRomance', (cb) => act(socket, () => rooms.drawRomance(socket.id), cb));
  socket.on('setOthelloLover', ({ loverId }, cb) =>
    act(socket, () => rooms.setOthelloLover(socket.id, loverId), cb)
  );
  socket.on('claudiusPickWs', ({ workstationIndex }, cb) =>
    act(socket, () => rooms.claudiusPickWs(socket.id, workstationIndex), cb)
  );

  socket.on('proposeTrade', ({ toId, offerCardId }, cb) =>
    act(socket, () => rooms.proposeTrade(socket.id, toId, offerCardId), cb)
  );
  socket.on('respondTrade', ({ accept, responseCardId }, cb) =>
    act(socket, () => rooms.respondTrade(socket.id, accept, responseCardId), cb)
  );
  socket.on('cancelTrade', (cb) => act(socket, () => rooms.cancelTrade(socket.id), cb));

  socket.on('useSyringe', (payload, cb) =>
    act(socket, () => rooms.useSyringe(socket.id, payload || {}), cb)
  );

  // Legacy no-ops so old clients don't crash server
  socket.on('discard', (_p, cb) => {
    if (typeof cb === 'function') cb({ ok: false, error: '본작 규칙: 전원 버리기를 사용하세요.' });
  });
  socket.on('administer', (_p, cb) => {
    if (typeof cb === 'function')
      cb({ ok: false, error: '본작 규칙: 손패가 마지막 한 장이 되면 자동 종료됩니다.' });
  });

  socket.on('disconnect', () => {
    const result = rooms.handleDisconnect(socket.id);
    if (result?.room) emitViews(result.room);
    console.log('disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Antidote (official ruleset) on :${PORT} (static: ${hasClient})`);
});
