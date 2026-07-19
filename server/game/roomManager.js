const crypto = require('crypto');
const { setupGame, FORMULAS, formulaById } = require('./deck');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GRACE_LOBBY_MS = 45_000;
const GRACE_PLAYING_MS = 30 * 60_000;
const ROOM_IDLE_MS = 2 * 60 * 60_000;
const SILENT_ID = '__SILENT__';

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
    status: 'lobby',
    players: {},
    order: [], // human player order (turn order)
    seatOrder: [], // includes silent for pass adjacency
    turnIndex: 0,
    antidoteFormulaId: null,
    hands: {},
    workstations: {},
    pending: null,
    log: [],
    winners: [],
    scores: {},
    config: null,
    formulas: FORMULAS.slice(0, 7),
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

  isHuman(id) {
    return id && id !== SILENT_ID;
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
    if (room.order.length >= 7) return { error: '방이 가득 찼습니다 (최대 7명).' };

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
    room.seatOrder = room.seatOrder.filter((id) => id !== playerId);

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

    this.pushLog(room, reason === 'timeout' ? `${name}님이 재접속하지 않아 퇴장 처리되었습니다.` : `${name}님이 나갔습니다.`);
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
    if (room.order.length > 7) return { error: '최대 7명입니다.' };
    if (room.order.filter((id) => room.players[id]?.connected).length < 2) {
      return { error: '접속 중인 플레이어가 2명 이상이어야 합니다.' };
    }

    const setup = setupGame(room.order);
    room.antidoteFormulaId = setup.antidoteFormulaId;
    room.hands = setup.hands;
    room.workstations = setup.workstations;
    room.config = setup.config;
    room.formulas = setup.formulas;
    room.seatOrder = setup.seatIds;
    room.turnIndex = Math.floor(Math.random() * room.order.length);
    room.status = 'playing';
    room.pending = null;
    room.winners = [];
    room.scores = {};

    const c = setup.config;
    this.pushLog(
      room,
      `게임 시작 — 표1: 포뮬러 ${c.formulas}종, 숫자 1–${c.maxNumber}, 주사기 ${c.syringes}장, 시작 손 ${c.handSize}장` +
        (c.silentMode ? ' · 2인: 투명 플레이어 포함' : '')
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
    return (hand || []).find((c) => c.id === cardId) || null;
  }

  removeCard(hand, cardId) {
    const i = (hand || []).findIndex((c) => c.id === cardId);
    if (i === -1) return null;
    return hand.splice(i, 1)[0];
  }

  /** Humans who must pick a card from hand (mass actions) */
  humansWithCards(room) {
    return room.order.filter((id) => (room.hands[id] || []).length > 0);
  }

  // ─── 1. 카드 버리기 (전원 동시, 워크스테이션) ───
  // 2인: 투명 플레이어는 버리지 않음 (규칙)

  beginMassDiscard(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || ctx.room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    const { room, playerId } = ctx;
    if (room.pending) return { error: '진행 중인 행동이 있습니다.' };
    this.ensureActiveTurn(room);
    if (this.currentPlayerId(room) !== playerId) return { error: '당신의 턴이 아닙니다.' };

    const need = this.humansWithCards(room);
    if (!need.length) return { error: '버릴 카드가 없습니다.' };
    if (need.some((id) => (room.hands[id] || []).length < 1)) {
      return { error: '손패가 있는 플레이어만 버립니다.' };
    }

    room.pending = {
      type: 'massDiscard',
      initiatorId: playerId,
      selections: {},
      need: need.slice(),
    };
    this.pushLog(room, `${room.players[playerId].name}님: 카드 버리기! (전원 동시 → 각자 워크스테이션, X는 뒷면)`);
    this.touch(room);
    return { room };
  }

  // ─── 2A. 전원 패스 ───

  beginMassPass(socketId, direction) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || ctx.room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    const { room, playerId } = ctx;
    if (room.pending) return { error: '진행 중인 행동이 있습니다.' };
    this.ensureActiveTurn(room);
    if (this.currentPlayerId(room) !== playerId) return { error: '당신의 턴이 아닙니다.' };
    if (direction !== 'left' && direction !== 'right') return { error: '방향을 선택하세요 (left|right).' };

    const need = this.humansWithCards(room);
    if (need.length < 1) return { error: '패스할 카드가 없습니다.' };

    room.pending = {
      type: 'massPass',
      direction,
      initiatorId: playerId,
      selections: {},
      need: need.slice(),
    };
    // Silent auto-selects when resolving
    this.pushLog(
      room,
      `${room.players[playerId].name}님: 전원 카드 패스 (${direction === 'left' ? '왼쪽' : '오른쪽'})`
    );
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
    if (!this.findCard(room.hands[playerId], cardId)) return { error: '손패에 없는 카드입니다.' };

    p.selections[playerId] = cardId;
    this.touch(room);
    this.tryResolvePending(room);
    return { room };
  }

  tryResolvePending(room) {
    const p = room.pending;
    if (!p || !p.need) return;

    const connectedNeed = p.need.filter((id) => room.players[id]?.connected);
    if (!connectedNeed.every((id) => p.selections[id])) return;

    for (const id of p.need) {
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
      const card = this.removeCard(room.hands[pid], p.selections[pid]);
      if (!card) continue;
      const faceUp = card.type !== 'x';
      if (!room.workstations[pid]) room.workstations[pid] = [];
      room.workstations[pid].push({ card, faceUp });
    }
    // 2인: 투명 플레이어는 버리지 않음
    this.pushLog(room, '전원 버리기 완료. (숫자·주사기 앞면 / X 뒷면)');
    room.pending = null;
    this.advanceTurn(room);
  }

  resolveMassPass(room) {
    const p = room.pending;
    const seats = room.seatOrder.length ? room.seatOrder : room.order;
    const n = seats.length;
    const giving = {};

    // Humans
    for (const pid of Object.keys(p.selections)) {
      const card = this.removeCard(room.hands[pid], p.selections[pid]);
      if (card) giving[pid] = card;
    }

    // Silent auto: random card from hand if has cards
    if (room.config?.silentMode && (room.hands[SILENT_ID] || []).length) {
      const sh = room.hands[SILENT_ID];
      const ri = Math.floor(Math.random() * sh.length);
      giving[SILENT_ID] = sh.splice(ri, 1)[0];
    }

    for (const fromId of Object.keys(giving)) {
      const fromIdx = seats.indexOf(fromId);
      if (fromIdx < 0) continue;
      let toIdx;
      if (p.direction === 'right') toIdx = (fromIdx + 1) % n;
      else toIdx = (fromIdx - 1 + n) % n;
      const toId = seats[toIdx];
      if (!room.hands[toId]) room.hands[toId] = [];
      room.hands[toId].push(giving[fromId]);
    }

    this.pushLog(room, `전원 패스 완료 (${p.direction === 'left' ? '왼쪽' : '오른쪽'}).`);
    room.pending = null;
    this.advanceTurn(room);
  }

  // ─── 2B. 1:1 거래 (투명과 불가) ───

  proposeTrade(socketId, toId, offerCardId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || ctx.room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    const { room, playerId } = ctx;
    if (room.pending) return { error: '진행 중인 행동이 있습니다.' };
    this.ensureActiveTurn(room);
    if (this.currentPlayerId(room) !== playerId) return { error: '당신의 턴이 아닙니다.' };
    if (toId === SILENT_ID) return { error: '투명 플레이어와는 1:1 거래할 수 없습니다. (2인 규칙)' };
    if (!room.players[toId] || toId === playerId) return { error: '상대가 올바르지 않습니다.' };
    if (!room.players[toId].connected) return { error: '상대가 접속 중이 아닙니다.' };
    if (!this.findCard(room.hands[playerId], offerCardId)) return { error: '카드가 없습니다.' };

    room.pending = { type: 'trade', fromId: playerId, toId, offerCardId };
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
      this.pushLog(room, `${room.players[playerId].name}님이 거래를 거절했습니다. (제안자 턴 유지 — 다른 행동 가능)`);
      room.pending = null;
      this.touch(room);
      return { room };
    }

    const offer = this.findCard(room.hands[t.fromId], t.offerCardId);
    const response = this.findCard(room.hands[t.toId], responseCardId);
    if (!offer || !response) return { error: '교환할 카드가 유효하지 않습니다.' };

    this.removeCard(room.hands[t.fromId], t.offerCardId);
    this.removeCard(room.hands[t.toId], responseCardId);
    room.hands[t.fromId].push(response);
    room.hands[t.toId].push(offer);
    this.pushLog(room, `${room.players[t.fromId].name} ↔ ${room.players[t.toId].name} 1:1 교환 완료.`);
    room.pending = null;
    this.advanceTurn(room);
    return { room };
  }

  cancelTrade(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx?.room.pending || ctx.room.pending.type !== 'trade') return { error: '취소할 거래가 없습니다.' };
    if (ctx.room.pending.fromId !== ctx.playerId) return { error: '제안자만 취소할 수 있습니다.' };
    ctx.room.pending = null;
    this.pushLog(ctx.room, '거래 제안 취소. (턴 유지)');
    this.touch(ctx.room);
    return { room: ctx.room };
  }

  // ─── 3. 주사기: 손(랜덤) 또는 WS(선택). 훔친 자리에 주사기 놓음 ───
  // 투명 손에서 훔치면 주사기를 뒷면으로 그 자리에 (규칙)

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

    const targetId = targetPlayerId;
    if (!targetId || targetId === playerId) return { error: '대상을 선택하세요.' };
    if (this.isHuman(targetId) && !room.players[targetId]) return { error: '대상이 없습니다.' };
    if (targetId === SILENT_ID && !room.config?.silentMode) return { error: '투명 플레이어가 없습니다.' };

    const syringe = hand.splice(syIdx, 1)[0];
    const pname = room.players[playerId].name;
    const tname =
      targetId === SILENT_ID ? '투명 플레이어' : room.players[targetId]?.name || '?';

    if (mode === 'hand') {
      const th = room.hands[targetId] || [];
      if (!th.length) {
        hand.push(syringe);
        return { error: '상대 손패가 비어 있습니다.' };
      }
      const ri = Math.floor(Math.random() * th.length);
      const stolen = th.splice(ri, 1)[0];
      hand.push(stolen);

      if (targetId === SILENT_ID) {
        // 주사기를 훔친 자리(손)에 뒷면으로
        th.splice(ri, 0, syringe);
        // mark? silent hand cards aren't visible; syringe sits face-down in hand
        this.pushLog(room, `${pname}님이 주사기로 투명 플레이어 손에서 카드를 훔쳤습니다. (주사기 뒷면 교체)`);
      } else {
        if (!room.workstations[targetId]) room.workstations[targetId] = [];
        room.workstations[targetId].push({ card: syringe, faceUp: true });
        this.pushLog(room, `${pname}님이 주사기로 ${tname}님 손패에서 카드를 훔쳤습니다. (주사기→WS 앞면)`);
      }
      this.advanceTurn(room);
      return { room };
    }

    if (mode === 'workstation') {
      const ws = room.workstations[targetId] || [];
      if (!ws.length) {
        hand.push(syringe);
        return { error: '상대 워크스테이션이 비어 있습니다.' };
      }
      let wi = typeof workstationIndex === 'number' ? workstationIndex : -1;
      if (wi < 0 || wi >= ws.length) wi = ws.length - 1;
      const taken = ws[wi];
      hand.push(taken.card);
      // 훔친 자리에 주사기 (앞면 — 규칙: WS면 보이도록)
      ws[wi] = { card: syringe, faceUp: true };
      this.pushLog(room, `${pname}님이 주사기로 ${tname} 워크스테이션 카드를 가져갔습니다.`);
      this.advanceTurn(room);
      return { room };
    }

    hand.push(syringe);
    return { error: '모드: hand 또는 workstation' };
  }

  checkGameEnd(room) {
    if (room.status !== 'playing') return;
    // 인간 플레이어 기준 최대 손패 ≤ 1
    const maxHand = Math.max(0, ...room.order.map((id) => (room.hands[id] || []).length));
    if (maxHand <= 1) this.endGame(room, '타임 아웃 — 손패가 마지막 한 장');
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
      // A: 일치 → +숫자 / B: 불일치 숫자 → -숫자 / C: 주사기(또는 비숫자) → -1
      // X as last: treat as not antidote drink properly → -1 (not a number formula drink)
      if (!last) {
        score = -1;
      } else if (last.type === 'number') {
        if (last.formulaId === trueId) {
          score = last.value || 0;
          winners.push(pid);
        } else {
          score = -(last.value || 0);
        }
      } else if (last.type === 'syringe') {
        score = -1;
      } else {
        // X card as last
        score = -1;
      }
      scores[pid] = { score, lastCard: last };
    }

    room.scores = scores;
    room.winners = winners;
    const tname = formulaById(trueId)?.name || trueId;
    this.pushLog(room, `타임 아웃! (${reason}) 해독제: ${tname}`);
    const winNames = winners.map((id) => room.players[id]?.name).filter(Boolean);
    this.pushLog(
      room,
      winNames.length ? `생존: ${winNames.join(', ')}` : '생존자 없음'
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

  workstationView(room, ownerId, viewerId) {
    const ws = room.workstations[ownerId] || [];
    return ws.map((slot, index) => {
      if (slot.faceUp || ownerId === viewerId) {
        return { index, faceUp: !!slot.faceUp, card: slot.card };
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
    const formulas = room.formulas || FORMULAS.slice(0, 7);

    const playersPublic = room.order.map((id) => ({
      id,
      name: room.players[id]?.name || '?',
      connected: !!room.players[id]?.connected,
      handCount: (room.hands[id] || []).length,
      isHost: room.hostId === id,
      isMe: id === playerId,
      workstation: this.workstationView(room, id, playerId),
      isSilent: false,
    }));

    // 2인: 투명 플레이어 표시 (손 장수만, WS)
    if (room.config?.silentMode) {
      playersPublic.push({
        id: SILENT_ID,
        name: '투명 플레이어',
        connected: true,
        handCount: (room.hands[SILENT_ID] || []).length,
        isHost: false,
        isMe: false,
        workstation: this.workstationView(room, SILENT_ID, playerId),
        isSilent: true,
      });
    }

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
              ? this.findCard(room.hands[p.fromId], p.offerCardId)
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
      formulas,
      config: room.config,
      pending,
      log: room.log.slice(-24),
      me: playerId,
      ruleset: 'antidote-ko-rulebook',
      silentMode: !!room.config?.silentMode,
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

module.exports = { RoomManager, FORMULAS, SILENT_ID };
