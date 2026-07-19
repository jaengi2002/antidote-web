const crypto = require('crypto');
const { setupGame, FORMULAS, formulaById } = require('./deck');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GRACE_LOBBY_MS = 45_000;
const GRACE_PLAYING_MS = 30 * 60_000;
const ROOM_IDLE_MS = 2 * 60 * 60_000;

function makeRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function makeId() {
  return crypto.randomBytes(16).toString('hex');
}

function sanitizeName(playerName) {
  return (playerName || 'Player').trim().slice(0, 16) || 'Player';
}

function createEmptyRoom(code) {
  return {
    code,
    hostId: null,
    status: 'lobby', // lobby | playing | ended
    players: {},
    order: [],
    turnIndex: 0,
    antidoteFormulaId: null,
    hands: {},
    workstations: {}, // playerId -> [{ card, faceUp }]
    pending: null, // mass discard / mass pass / trade
    log: [],
    winners: [],
    scores: {},
    config: null,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.socketIndex = new Map();
    this.tokenIndex = new Map();
    this.graceTimers = new Map();
  }

  touch(room) {
    if (room) room.lastActiveAt = Date.now();
  }

  getPlayerBySocket(socketId) {
    const ref = this.socketIndex.get(socketId);
    if (!ref) return null;
    const room = this.rooms.get(ref.code);
    if (!room) return null;
    const player = room.players[ref.playerId];
    if (!player) return null;
    return { room, player, playerId: ref.playerId };
  }

  clearGrace(playerId) {
    const t = this.graceTimers.get(playerId);
    if (t) {
      clearTimeout(t);
      this.graceTimers.delete(playerId);
    }
  }

  scheduleGrace(playerId, code) {
    this.clearGrace(playerId);
    const room = this.rooms.get(code);
    if (!room) return;
    const ms = room.status === 'playing' ? GRACE_PLAYING_MS : GRACE_LOBBY_MS;
    const timer = setTimeout(() => {
      this.graceTimers.delete(playerId);
      this.removePlayer(playerId, code, 'timeout');
    }, ms);
    this.graceTimers.set(playerId, timer);
  }

  bindSocket(socketId, code, playerId) {
    this.socketIndex.set(socketId, { code, playerId });
  }

  unbindSocket(socketId) {
    this.socketIndex.delete(socketId);
  }

  createRoom(socketId, playerName) {
    let code = makeRoomCode();
    while (this.rooms.has(code)) code = makeRoomCode();
    const playerId = makeId();
    const sessionToken = makeId();
    const room = createEmptyRoom(code);
    room.hostId = playerId;
    room.players[playerId] = {
      id: playerId,
      name: sanitizeName(playerName),
      socketId,
      connected: true,
      sessionToken,
    };
    room.order.push(playerId);
    this.rooms.set(code, room);
    this.bindSocket(socketId, code, playerId);
    this.tokenIndex.set(sessionToken, { code, playerId });
    this.pushLog(room, `${room.players[playerId].name}님이 방을 만들었습니다.`);
    this.touch(room);
    return { room, playerId, sessionToken };
  }

  joinRoom(socketId, code, playerName) {
    const normalized = (code || '').toUpperCase().trim();
    const room = this.rooms.get(normalized);
    if (!room) return { error: '방을 찾을 수 없습니다.' };
    if (room.status !== 'lobby') return { error: '이미 시작한 방입니다. 세션이 있으면 재접속하세요.' };
    if (room.order.length >= 6) return { error: '방이 가득 찼습니다 (최대 6명).' };

    const playerId = makeId();
    const sessionToken = makeId();
    room.players[playerId] = {
      id: playerId,
      name: sanitizeName(playerName),
      socketId,
      connected: true,
      sessionToken,
    };
    room.order.push(playerId);
    this.bindSocket(socketId, normalized, playerId);
    this.tokenIndex.set(sessionToken, { code: normalized, playerId });
    this.pushLog(room, `${room.players[playerId].name}님이 입장했습니다.`);
    this.touch(room);
    return { room, playerId, sessionToken };
  }

  reconnect(socketId, sessionToken) {
    if (!sessionToken) return { error: '세션이 없습니다.' };
    const ref = this.tokenIndex.get(sessionToken);
    if (!ref) return { error: '세션이 만료되었거나 유효하지 않습니다.' };
    const room = this.rooms.get(ref.code);
    if (!room) {
      this.tokenIndex.delete(sessionToken);
      return { error: '방이 더 이상 없습니다.' };
    }
    const player = room.players[ref.playerId];
    if (!player || player.sessionToken !== sessionToken) return { error: '세션이 유효하지 않습니다.' };

    if (player.socketId && player.socketId !== socketId) this.unbindSocket(player.socketId);
    player.socketId = socketId;
    player.connected = true;
    this.clearGrace(ref.playerId);
    this.bindSocket(socketId, ref.code, ref.playerId);
    this.pushLog(room, `${player.name}님이 다시 연결되었습니다.`);
    this.touch(room);
    return { room, playerId: ref.playerId, sessionToken };
  }

  handleDisconnect(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx) return null;
    const { room, player, playerId } = ctx;
    player.connected = false;
    player.socketId = null;
    this.unbindSocket(socketId);

    if (room.pending && room.pending.selections) {
      // leave selection empty; timeout path via grace not for pending
    }
    if (room.pending?.type === 'trade' && (room.pending.fromId === playerId || room.pending.toId === playerId)) {
      room.pending = null;
      this.pushLog(room, `${player.name}님 연결 끊김으로 거래가 취소되었습니다.`);
    }

    this.pushLog(room, `${player.name}님의 연결이 끊겼습니다. (재접속 대기)`);
    this.scheduleGrace(playerId, room.code);
    this.touch(room);
    return { room, soft: true };
  }

  leaveExplicit(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx) return null;
    return this.removePlayer(ctx.playerId, ctx.room.code, 'leave');
  }

  removePlayer(playerId, code, reason) {
    const room = this.rooms.get(code);
    if (!room || !room.players[playerId]) return null;
    const player = room.players[playerId];
    const name = player.name;
    this.clearGrace(playerId);
    if (player.socketId) this.unbindSocket(player.socketId);
    if (player.sessionToken) this.tokenIndex.delete(player.sessionToken);

    const idx = room.order.indexOf(playerId);
    if (idx !== -1) {
      if (idx < room.turnIndex) room.turnIndex -= 1;
      room.order.splice(idx, 1);
      if (room.order.length) room.turnIndex = Math.max(0, room.turnIndex) % room.order.length;
      else room.turnIndex = 0;
    }

    delete room.players[playerId];
    delete room.hands[playerId];
    delete room.workstations[playerId];

    if (room.pending) {
      if (room.pending.type === 'trade' && (room.pending.fromId === playerId || room.pending.toId === playerId)) {
        room.pending = null;
      } else if (room.pending.selections) {
        delete room.pending.selections[playerId];
        this.tryResolvePending(room);
      }
    }

    if (!room.order.length) {
      this.rooms.delete(code);
      return { code, empty: true, room: null };
    }

    if (room.hostId === playerId) {
      room.hostId = room.order[0];
      this.pushLog(room, `호스트가 ${room.players[room.hostId].name}님으로 변경되었습니다.`);
    }

    const msg =
      reason === 'timeout'
        ? `${name}님이 재접속하지 않아 퇴장 처리되었습니다.`
        : `${name}님이 나갔습니다.`;
    this.pushLog(room, room.status === 'playing' ? `${msg}` : msg);
    this.touch(room);

    if (room.status === 'playing' && room.order.length < 2) {
      this.endGame(room, '인원 부족');
    }
    return { code, room };
  }

  startGame(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx) return { error: '방에 있지 않습니다.' };
    const { room, playerId } = ctx;
    if (room.hostId !== playerId) return { error: '호스트만 시작할 수 있습니다.' };
    if (room.status !== 'lobby') return { error: '이미 시작했습니다.' };
    if (room.order.length < 2) return { error: '최소 2명이 필요합니다.' };
    if (room.order.filter((id) => room.players[id]?.connected).length < 2) {
      return { error: '접속 중인 플레이어가 2명 이상이어야 합니다.' };
    }

    const setup = setupGame(room.order);
    room.antidoteFormulaId = setup.antidoteFormulaId;
    room.hands = setup.hands;
    room.workstations = setup.workstations;
    room.config = setup.config;
    room.turnIndex = Math.floor(Math.random() * room.order.length);
    room.status = 'playing';
    room.pending = null;
    room.winners = [];
    room.scores = {};
    this.pushLog(
      room,
      `게임 시작 (인원 ${setup.config.playerCount}, 숫자 1–${setup.config.maxNumber}, 주사기 ${setup.config.syringeN}장). 마지막 한 장이 해독제여야 합니다.`
    );
    this.touch(room);
    return { room };
  }

  currentPlayerId(room) {
    if (!room.order.length) return null;
    return room.order[room.turnIndex % room.order.length];
  }

  ensureActiveTurn(room) {
    if (room.status !== 'playing' || !room.order.length || room.pending) return;
    let guard = 0;
    while (guard < room.order.length) {
      const pid = this.currentPlayerId(room);
      if (room.players[pid]?.connected) return;
      room.turnIndex = (room.turnIndex + 1) % room.order.length;
      guard += 1;
    }
  }

  advanceTurn(room) {
    if (!room.order.length) return;
    room.pending = null;
    room.turnIndex = (room.turnIndex + 1) % room.order.length;
    this.ensureActiveTurn(room);
    this.touch(room);
    this.checkGameEnd(room);
  }

  pushLog(room, message) {
    room.log.push({ t: Date.now(), message });
    if (room.log.length > 60) room.log = room.log.slice(-60);
  }

  findCard(hand, cardId) {
    return hand.find((c) => c.id === cardId) || null;
  }

  removeCard(hand, cardId) {
    const i = hand.findIndex((c) => c.id === cardId);
    if (i === -1) return null;
    return hand.splice(i, 1)[0];
  }

  playersWhoMustSelect(room) {
    return room.order.filter((id) => (room.hands[id] || []).length > 0);
  }

  // ─── Official action 1: Discard (ALL players simultaneously to workstation) ───

  beginMassDiscard(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || ctx.room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    const { room, playerId } = ctx;
    if (room.pending) return { error: '진행 중인 행동이 있습니다.' };
    this.ensureActiveTurn(room);
    if (this.currentPlayerId(room) !== playerId) return { error: '당신의 턴이 아닙니다.' };

    const need = this.playersWhoMustSelect(room);
    if (!need.length) return { error: '버릴 카드가 있는 플레이어가 없습니다.' };
    if (need.some((id) => (room.hands[id] || []).length < 1)) {
      return { error: '모든 플레이어가 손패가 1장 이상이어야 버립니다.' };
    }

    room.pending = {
      type: 'massDiscard',
      initiatorId: playerId,
      selections: {},
      need: need.slice(),
    };
    this.pushLog(room, `${room.players[playerId].name}님: 전원 카드 버리기! (각자 워크스테이션에 동시 공개)`);
    this.touch(room);
    return { room };
  }

  // ─── Official action 2A: Pass left/right ───

  beginMassPass(socketId, direction) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || ctx.room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    const { room, playerId } = ctx;
    if (room.pending) return { error: '진행 중인 행동이 있습니다.' };
    this.ensureActiveTurn(room);
    if (this.currentPlayerId(room) !== playerId) return { error: '당신의 턴이 아닙니다.' };
    if (direction !== 'left' && direction !== 'right') return { error: '방향이 올바르지 않습니다.' };

    const need = this.playersWhoMustSelect(room);
    if (need.length < 2) return { error: '패스할 플레이어가 부족합니다.' };

    room.pending = {
      type: 'massPass',
      direction,
      initiatorId: playerId,
      selections: {},
      need: need.slice(),
    };
    const dirKo = direction === 'left' ? '왼쪽(이전 순서)' : '오른쪽(다음 순서)';
    this.pushLog(room, `${room.players[playerId].name}님: 전원 ${dirKo}으로 카드 한 장 패스!`);
    this.touch(room);
    return { room };
  }

  selectPendingCard(socketId, cardId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || ctx.room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    const { room, playerId } = ctx;
    const p = room.pending;
    if (!p || (p.type !== 'massDiscard' && p.type !== 'massPass')) {
      return { error: '선택 단계가 아닙니다.' };
    }
    if (!p.need.includes(playerId)) return { error: '선택할 필요가 없습니다.' };
    if (!this.findCard(room.hands[playerId] || [], cardId)) return { error: '손패에 없는 카드입니다.' };

    p.selections[playerId] = cardId;
    this.touch(room);
    this.tryResolvePending(room);
    return { room };
  }

  tryResolvePending(room) {
    const p = room.pending;
    if (!p || !p.need) return;

    // Only require selections from connected players still in need
    const activeNeed = p.need.filter((id) => room.players[id] && (room.hands[id] || []).length > 0);
    const allIn =
      activeNeed.length > 0 && activeNeed.every((id) => p.selections[id] || !room.players[id]?.connected);

    // Wait for all connected players who need to select
    const connectedNeed = activeNeed.filter((id) => room.players[id]?.connected);
    if (!connectedNeed.every((id) => p.selections[id])) return;

    // Offline without selection: auto first card
    for (const id of activeNeed) {
      if (!p.selections[id] && (room.hands[id] || []).length) {
        p.selections[id] = room.hands[id][0].id;
      }
    }

    if (p.type === 'massDiscard') this.resolveMassDiscard(room);
    else if (p.type === 'massPass') this.resolveMassPass(room);
  }

  resolveMassDiscard(room) {
    const p = room.pending;
    for (const pid of Object.keys(p.selections)) {
      const card = this.removeCard(room.hands[pid] || [], p.selections[pid]);
      if (!card) continue;
      // X face-down, number/syringe face-up
      const faceUp = card.type !== 'x';
      if (!room.workstations[pid]) room.workstations[pid] = [];
      room.workstations[pid].push({ card, faceUp });
    }
    this.pushLog(room, '전원 버리기 완료. (숫자·주사기 앞면 / X 뒷면)');
    room.pending = null;
    this.advanceTurn(room);
  }

  resolveMassPass(room) {
    const p = room.pending;
    const order = room.order.filter((id) => (room.hands[id] || []).length > 0 || p.selections[id]);
    // Build map of who gives what
    const giving = {};
    for (const pid of Object.keys(p.selections)) {
      const card = this.removeCard(room.hands[pid] || [], p.selections[pid]);
      if (card) giving[pid] = card;
    }

    // Direction: "right" = next in order (higher index), "left" = previous
    const n = room.order.length;
    for (const fromId of Object.keys(giving)) {
      const fromIdx = room.order.indexOf(fromId);
      if (fromIdx < 0) continue;
      let toIdx;
      if (p.direction === 'right') toIdx = (fromIdx + 1) % n;
      else toIdx = (fromIdx - 1 + n) % n;
      const toId = room.order[toIdx];
      if (!room.hands[toId]) room.hands[toId] = [];
      room.hands[toId].push(giving[fromId]);
    }

    this.pushLog(
      room,
      `전원 패스 완료 (${p.direction === 'left' ? '왼쪽' : '오른쪽'}).`
    );
    room.pending = null;
    this.advanceTurn(room);
  }

  // ─── Official action 2B: One-to-one trade ───

  proposeTrade(socketId, toId, offerCardId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || ctx.room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    const { room, playerId } = ctx;
    if (room.pending) return { error: '진행 중인 행동이 있습니다.' };
    this.ensureActiveTurn(room);
    if (this.currentPlayerId(room) !== playerId) return { error: '당신의 턴이 아닙니다.' };
    if (!room.players[toId] || toId === playerId) return { error: '상대가 올바르지 않습니다.' };
    if (!room.players[toId].connected) return { error: '상대가 접속 중이 아닙니다.' };
    if (!this.findCard(room.hands[playerId] || [], offerCardId)) return { error: '카드가 없습니다.' };

    room.pending = {
      type: 'trade',
      fromId: playerId,
      toId,
      offerCardId,
    };
    this.pushLog(
      room,
      `${room.players[playerId].name}님이 ${room.players[toId].name}님에게 1:1 거래를 제안했습니다.`
    );
    this.touch(room);
    return { room };
  }

  respondTrade(socketId, accept, responseCardId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || ctx.room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    const { room, playerId } = ctx;
    const t = room.pending;
    if (!t || t.type !== 'trade' || t.toId !== playerId) return { error: '받을 거래가 없습니다.' };

    if (!accept) {
      this.pushLog(room, `${room.players[playerId].name}님이 거래를 거절했습니다. (제안자 턴 유지)`);
      room.pending = null;
      this.touch(room);
      // Official: still your turn, choose different action — do NOT advance
      return { room };
    }

    const fromHand = room.hands[t.fromId];
    const toHand = room.hands[t.toId];
    const offer = this.findCard(fromHand, t.offerCardId);
    const response = this.findCard(toHand, responseCardId);
    if (!offer || !response) return { error: '교환할 카드가 유효하지 않습니다.' };

    this.removeCard(fromHand, t.offerCardId);
    this.removeCard(toHand, responseCardId);
    fromHand.push(response);
    toHand.push(offer);
    this.pushLog(
      room,
      `${room.players[t.fromId].name} ↔ ${room.players[t.toId].name} 1:1 교환 완료.`
    );
    room.pending = null;
    this.advanceTurn(room);
    return { room };
  }

  cancelTrade(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || !ctx.room.pending || ctx.room.pending.type !== 'trade') {
      return { error: '취소할 거래가 없습니다.' };
    }
    if (ctx.room.pending.fromId !== ctx.playerId) return { error: '제안자만 취소할 수 있습니다.' };
    ctx.room.pending = null;
    this.pushLog(ctx.room, '거래 제안이 취소되었습니다. (턴 유지)');
    this.touch(ctx.room);
    return { room: ctx.room };
  }

  // ─── Official action 3: Syringe ───
  // Steal from hand (random) OR workstation (chosen); syringe goes face-up on target workstation.

  useSyringe(socketId, { mode, targetPlayerId, workstationIndex }) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || ctx.room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    const { room, playerId } = ctx;
    if (room.pending) return { error: '진행 중인 행동이 있습니다.' };
    this.ensureActiveTurn(room);
    if (this.currentPlayerId(room) !== playerId) return { error: '당신의 턴이 아닙니다.' };

    const hand = room.hands[playerId] || [];
    const syIdx = hand.findIndex((c) => c.type === 'syringe');
    if (syIdx === -1) return { error: '손패에 주사기가 없습니다.' };
    if (!targetPlayerId || !room.players[targetPlayerId] || targetPlayerId === playerId) {
      return { error: '대상을 선택하세요.' };
    }

    const syringe = hand.splice(syIdx, 1)[0];
    const pname = room.players[playerId].name;
    const tname = room.players[targetPlayerId].name;

    if (mode === 'hand') {
      const th = room.hands[targetPlayerId] || [];
      if (!th.length) {
        hand.push(syringe);
        return { error: '상대 손패가 비어 있습니다.' };
      }
      const ri = Math.floor(Math.random() * th.length);
      const stolen = th.splice(ri, 1)[0];
      hand.push(stolen);
      if (!room.workstations[targetPlayerId]) room.workstations[targetPlayerId] = [];
      room.workstations[targetPlayerId].push({ card: syringe, faceUp: true });
      this.pushLog(room, `${pname}님이 주사기로 ${tname}님의 손패에서 카드를 훔쳤습니다.`);
      this.advanceTurn(room);
      return { room };
    }

    if (mode === 'workstation') {
      const ws = room.workstations[targetPlayerId] || [];
      if (!ws.length) {
        hand.push(syringe);
        return { error: '상대 워크스테이션이 비어 있습니다.' };
      }
      let wi = typeof workstationIndex === 'number' ? workstationIndex : -1;
      if (wi < 0 || wi >= ws.length) wi = ws.length - 1;
      const taken = ws.splice(wi, 1)[0];
      // Stolen card to hand (face-up knowledge for stealer); if was face-down X, stealer sees it
      hand.push(taken.card);
      ws.push({ card: syringe, faceUp: true });
      this.pushLog(
        room,
        `${pname}님이 주사기로 ${tname}님의 워크스테이션 카드를 가져갔습니다.`
      );
      this.advanceTurn(room);
      return { room };
    }

    hand.push(syringe);
    return { error: '주사기 모드가 올바르지 않습니다 (hand | workstation).' };
  }

  // ─── End game: when no player has more than 1 card in hand ───

  checkGameEnd(room) {
    if (room.status !== 'playing') return;
    const maxHand = Math.max(0, ...room.order.map((id) => (room.hands[id] || []).length));
    if (maxHand <= 1) {
      this.endGame(room, '손패가 마지막 한 장(이하)이 되어 종료');
    }
  }

  endGame(room, reason) {
    if (room.status === 'ended') return;
    room.status = 'ended';
    room.pending = null;
    const trueId = room.antidoteFormulaId;
    const scores = {};
    const winners = [];

    for (const pid of room.order) {
      const hand = room.hands[pid] || [];
      const last = hand[0] || null;
      let score = 0;
      if (!last) {
        score = -1;
      } else if (last.type === 'number') {
        if (last.formulaId === trueId) {
          score = last.value || 0;
          winners.push(pid);
        } else {
          score = -(last.value || 0);
        }
      } else {
        // X or syringe as last card
        score = -1;
      }
      scores[pid] = { score, lastCard: last };
    }

    room.scores = scores;
    room.winners = winners;
    const tname = formulaById(trueId)?.name || trueId;
    this.pushLog(room, `실험 종료 (${reason}). 해독제: ${tname}`);
    const winNames = winners.map((id) => room.players[id]?.name).filter(Boolean);
    this.pushLog(
      room,
      winNames.length
        ? `생존(마지막 카드가 해독제 공식): ${winNames.join(', ')}`
        : '생존자 없음 — 마지막 카드가 해독제 공식이 아닙니다.'
    );
    this.touch(room);
  }

  cleanupIdleRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActiveAt > ROOM_IDLE_MS) {
        for (const pid of [...room.order]) {
          const p = room.players[pid];
          if (p?.sessionToken) this.tokenIndex.delete(p.sessionToken);
          if (p?.socketId) this.unbindSocket(p.socketId);
          this.clearGrace(pid);
        }
        this.rooms.delete(code);
      }
    }
  }

  /** Workstation public view: hide face-down card identity from non-owners */
  workstationView(room, ownerId, viewerId) {
    const ws = room.workstations[ownerId] || [];
    return ws.map((slot, index) => {
      if (slot.faceUp || ownerId === viewerId) {
        return { index, faceUp: slot.faceUp, card: slot.card };
      }
      return {
        index,
        faceUp: false,
        card: { id: `hidden-${ownerId}-${index}`, type: 'hidden', label: '뒷면', symbol: null },
      };
    });
  }

  viewForPlayer(room, playerId) {
    this.ensureActiveTurn(room);

    const playersPublic = room.order.map((id) => ({
      id,
      name: room.players[id]?.name || '?',
      connected: !!room.players[id]?.connected,
      handCount: (room.hands[id] || []).length,
      isHost: room.hostId === id,
      isMe: id === playerId,
      workstation: this.workstationView(room, id, playerId),
    }));

    const myHand = room.hands[playerId] ? [...room.hands[playerId]] : [];

    let pending = null;
    if (room.pending) {
      const p = room.pending;
      if (p.type === 'massDiscard' || p.type === 'massPass') {
        pending = {
          type: p.type,
          direction: p.direction || null,
          initiatorId: p.initiatorId,
          initiatorName: room.players[p.initiatorId]?.name,
          needSelect: (p.need || []).includes(playerId) && !p.selections[playerId],
          iHaveSelected: !!p.selections[playerId],
          waitingNames: (p.need || [])
            .filter((id) => room.players[id]?.connected && !p.selections[id])
            .map((id) => room.players[id]?.name),
        };
      } else if (p.type === 'trade') {
        pending = {
          type: 'trade',
          fromId: p.fromId,
          toId: p.toId,
          fromName: room.players[p.fromId]?.name,
          toName: room.players[p.toId]?.name,
          offerCard:
            playerId === p.fromId || playerId === p.toId
              ? this.findCard(room.hands[p.fromId] || [], p.offerCardId)
              : null,
          amProposer: playerId === p.fromId,
          amTarget: playerId === p.toId,
        };
      }
    }

    const base = {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      players: playersPublic,
      turnPlayerId: room.status === 'playing' ? this.currentPlayerId(room) : null,
      isMyTurn:
        room.status === 'playing' && !room.pending && this.currentPlayerId(room) === playerId,
      myHand,
      formulas: FORMULAS,
      config: room.config,
      pending,
      log: room.log.slice(-24),
      me: playerId,
      ruleset: 'antidote-official-v1',
    };

    if (room.status === 'ended') {
      base.antidoteFormulaId = room.antidoteFormulaId;
      base.winners = room.winners;
      base.winnerNames = room.winners.map((id) => room.players[id]?.name).filter(Boolean);
      base.scores = {};
      base.allHands = {};
      base.allWorkstations = {};
      for (const id of room.order) {
        base.scores[id] = room.scores[id];
        base.allHands[id] = room.hands[id] || [];
        base.allWorkstations[id] = (room.workstations[id] || []).map((s) => ({
          faceUp: true,
          card: s.card,
        }));
      }
    }

    return base;
  }

  viewForSocket(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx) return null;
    return this.viewForPlayer(ctx.room, ctx.playerId);
  }
}

module.exports = { RoomManager, FORMULAS };
