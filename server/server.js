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
  res.json({ ok: true, rooms: rooms.rooms.size });
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
    res.type('text').send(
      'Antidote server OK. Build the client (npm run build) for production UI, or run Vite on :5173.'
    );
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

io.on('connection', (socket) => {
  console.log('connected', socket.id);

  socket.on('createRoom', ({ name }, cb) => {
    try {
      const result = rooms.createRoom(socket.id, name);
      replySession(socket, result, cb);
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  socket.on('joinRoom', ({ code, name }, cb) => {
    try {
      const result = rooms.joinRoom(socket.id, code, name);
      replySession(socket, result, cb);
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  socket.on('reconnectSession', ({ sessionToken }, cb) => {
    try {
      const result = rooms.reconnect(socket.id, sessionToken);
      replySession(socket, result, cb);
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  socket.on('leaveRoom', (cb) => {
    const result = rooms.leaveExplicit(socket.id);
    if (typeof cb === 'function') cb({ ok: true });
    if (result?.room) emitViews(result.room);
  });

  socket.on('startGame', (cb) => {
    const result = rooms.startGame(socket.id);
    if (result.error) {
      if (typeof cb === 'function') cb({ ok: false, error: result.error });
      return;
    }
    if (typeof cb === 'function') cb({ ok: true });
    emitViews(result.room);
  });

  socket.on('discard', ({ cardId }, cb) => {
    const result = rooms.discard(socket.id, cardId);
    if (result.error) {
      if (typeof cb === 'function') cb({ ok: false, error: result.error });
      return;
    }
    if (typeof cb === 'function') cb({ ok: true });
    emitViews(result.room);
  });

  socket.on('proposeTrade', ({ toId, offerCardId }, cb) => {
    const result = rooms.proposeTrade(socket.id, toId, offerCardId);
    if (result.error) {
      if (typeof cb === 'function') cb({ ok: false, error: result.error });
      return;
    }
    if (typeof cb === 'function') cb({ ok: true });
    emitViews(result.room);
  });

  socket.on('respondTrade', ({ accept, responseCardId }, cb) => {
    const result = rooms.respondTrade(socket.id, accept, responseCardId);
    if (result.error) {
      if (typeof cb === 'function') cb({ ok: false, error: result.error });
      return;
    }
    if (typeof cb === 'function') cb({ ok: true });
    emitViews(result.room);
  });

  socket.on('cancelTrade', (cb) => {
    const result = rooms.cancelTrade(socket.id);
    if (result.error) {
      if (typeof cb === 'function') cb({ ok: false, error: result.error });
      return;
    }
    if (typeof cb === 'function') cb({ ok: true });
    emitViews(result.room);
  });

  socket.on('useSyringe', (payload, cb) => {
    const result = rooms.useSyringe(socket.id, payload || {});
    if (result.error) {
      if (typeof cb === 'function') cb({ ok: false, error: result.error });
      return;
    }
    if (typeof cb === 'function') cb({ ok: true });
    emitViews(result.room);
  });

  socket.on('administer', ({ formulaId }, cb) => {
    const result = rooms.administer(socket.id, formulaId);
    if (result.error) {
      if (typeof cb === 'function') cb({ ok: false, error: result.error });
      return;
    }
    if (typeof cb === 'function') cb({ ok: true });
    emitViews(result.room);
  });

  socket.on('disconnect', () => {
    const result = rooms.handleDisconnect(socket.id);
    if (result?.room) emitViews(result.room);
    console.log('disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Antidote multiplayer server on :${PORT} (static client: ${hasClient})`);
});
