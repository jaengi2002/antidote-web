const crypto = require('crypto');
const { setupGame, FORMULAS } = require('./deck');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Lobby: remove seat if still offline after this. Playing: keep seat longer. */
const GRACE_LOBBY_MS = 45_000;
const GRACE_PLAYING_MS = 30 * 60_000;
const ROOM_IDLE_MS = 2 * 60 * 60_000;

function makeRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function makeId() {
  return crypto.randomBytes(16).toString('hex');
}

function createEmptyRoom(code) {
  return {
    code,
    hostId: null, // playerId
    status: 'lobby', // lobby | playing | ended
    players: {}, // playerId -> { id, name, socketId, connected, sessionToken }
    order: [], // playerIds
    turnIndex: 0,
    antidoteFormulaId: null,
    discardPile: [],
    hands: {},
    pendingTrade: null,
    log: [],
    winners: [],
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

class RoomManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.rooms = new Map();
    /** socketId -> { code, playerId } */
    this.socketIndex = new Map();
    /** sessionToken -> { code, playerId } */
    this.tokenIndex = new Map();
    /** playerId -> timeout handle for grace removal */
    this.graceTimers = new Map();
  }

  touch(room) {
    if (room) room.lastActiveAt = Date.now();
  }

  getRoomBySocket(socketId) {
    const ref = this.socketIndex.get(socketId);
    if (!ref) return null;
    return this.rooms.get(ref.code) || null;
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

  /**
   * @returns {{ room, playerId, sessionToken }}
   */
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
    if (room.status !== 'lobby') return { error: '이미 시작한 방입니다. 세션이 있으면 재접속을 시도하세요.' };
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

  /**
   * Reconnect with session token. Works in lobby/playing/ended while seat still exists.
   */
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
    if (!player || player.sessionToken !== sessionToken) {
      return { error: '세션이 유효하지 않습니다.' };
    }

    // Drop old socket binding if any
    if (player.socketId && player.socketId !== socketId) {
      this.unbindSocket(player.socketId);
    }

    player.socketId = socketId;
    player.connected = true;
    this.clearGrace(ref.playerId);
    this.bindSocket(socketId, ref.code, ref.playerId);
    this.pushLog(room, `${player.name}님이 다시 연결되었습니다.`);
    this.touch(room);
    return { room, playerId: ref.playerId, sessionToken };
  }

  /**
   * Soft disconnect: keep seat for grace period.
   */
  handleDisconnect(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx) return null;
    const { room, player, playerId } = ctx;

    player.connected = false;
    player.socketId = null;
    this.unbindSocket(socketId);

    // Cancel trade involving this player
    if (
      room.pendingTrade &&
      (room.pendingTrade.fromId === playerId || room.pendingTrade.toId === playerId)
    ) {
      room.pendingTrade = null;
      this.pushLog(room, `${player.name}님 연결 끊김으로 거래가 취소되었습니다.`);
    }

    this.pushLog(room, `${player.name}님의 연결이 끊겼습니다. (재접속 대기)`);
    this.scheduleGrace(playerId, room.code);
    this.touch(room);

    // If everyone offline in lobby, still wait grace
    return { room, soft: true };
  }

  /**
   * Explicit leave (user clicked 나가기) — remove immediately.
   */
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

    // Adjust turn index before removing from order
    const idx = room.order.indexOf(playerId);
    if (idx !== -1) {
      if (room.status === 'playing' && room.order.length > 0) {
        if (idx < room.turnIndex) {
          room.turnIndex -= 1;
        } else if (idx === room.turnIndex) {
          // keep turnIndex pointing at "next" after removal
          // after splice, same index is next player
        }
      }
      room.order.splice(idx, 1);
      if (room.order.length === 0) {
        room.turnIndex = 0;
      } else {
        room.turnIndex = room.turnIndex % room.order.length;
      }
    }

    delete room.players[playerId];
    if (room.hands[playerId]) delete room.hands[playerId];

    if (
      room.pendingTrade &&
      (room.pendingTrade.fromId === playerId || room.pendingTrade.toId === playerId)
    ) {
      room.pendingTrade = null;
    }

    if (room.order.length === 0) {
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
    this.pushLog(room, room.status === 'playing' ? `${msg} (게임 계속)` : msg);
    this.touch(room);

    // Not enough players mid-game
    if (room.status === 'playing' && room.order.length < 2) {
      room.status = 'ended';
      room.winners = [];
      this.pushLog(room, '인원 부족으로 게임이 종료되었습니다.');
    }

    return { code, room };
  }

  startGame(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx) return { error: '방에 있지 않습니다.' };
    const { room, playerId } = ctx;
    if (room.hostId !== playerId) return { error: '호스트만 시작할 수 있습니다.' };
    if (room.status !== 'lobby') return { error: '이미 시작했습니다.' };

    const connectedOrder = room.order.filter((id) => room.players[id]?.connected);
    // Allow start if at least 2 seats; offline seats still count if they exist
    if (room.order.length < 2) return { error: '최소 2명이 필요합니다.' };
    if (room.order.length > 6) return { error: '최대 6명입니다.' };
    if (connectedOrder.length < 2) return { error: '접속 중인 플레이어가 2명 이상이어야 합니다.' };

    const setup = setupGame(room.order);
    room.antidoteFormulaId = setup.antidoteFormulaId;
    room.hands = setup.hands;
    room.discardPile = [];
    room.turnIndex = 0;
    room.status = 'playing';
    room.pendingTrade = null;
    room.winners = [];
    room.guessedFormulaId = null;
    room.administeredBy = null;
    this.pushLog(room, '게임이 시작되었습니다! 해독제 공식을 추론하세요.');
    this.touch(room);
    return { room };
  }

  currentPlayerId(room) {
    if (!room.order.length) return null;
    return room.order[room.turnIndex % room.order.length];
  }

  /** Skip disconnected players so the game does not stall forever. */
  ensureActiveTurn(room) {
    if (room.status !== 'playing' || !room.order.length) return;
    let guard = 0;
    while (guard < room.order.length) {
      const pid = this.currentPlayerId(room);
      const p = room.players[pid];
      if (p && p.connected) return;
      room.turnIndex = (room.turnIndex + 1) % room.order.length;
      room.pendingTrade = null;
      guard += 1;
    }
  }

  advanceTurn(room) {
    if (!room.order.length) return;
    room.turnIndex = (room.turnIndex + 1) % room.order.length;
    room.pendingTrade = null;
    this.ensureActiveTurn(room);
    this.touch(room);
  }

  pushLog(room, message) {
    room.log.push({ t: Date.now(), message });
    if (room.log.length > 50) room.log = room.log.slice(-50);
  }

  findCard(hand, cardId) {
    return hand.find((c) => c.id === cardId) || null;
  }

  removeCard(hand, cardId) {
    const i = hand.findIndex((c) => c.id === cardId);
    if (i === -1) return null;
    return hand.splice(i, 1)[0];
  }

  requireMyTurn(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx) return { error: '방에 있지 않습니다.' };
    const { room, playerId } = ctx;
    if (room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    this.ensureActiveTurn(room);
    if (this.currentPlayerId(room) !== playerId) return { error: '당신의 턴이 아닙니다.' };
    return { room, playerId };
  }

  discard(socketId, cardId) {
    const gate = this.requireMyTurn(socketId);
    if (gate.error) return gate;
    const { room, playerId } = gate;
    if (room.pendingTrade) return { error: '진행 중인 거래가 있습니다.' };

    const hand = room.hands[playerId];
    const card = this.removeCard(hand, cardId);
    if (!card) return { error: '카드를 찾을 수 없습니다.' };

    room.discardPile.push({ ...card, discardedBy: playerId });
    this.pushLog(room, `${room.players[playerId].name}님이 ${card.label} 카드를 버렸습니다.`);
    this.advanceTurn(room);
    return { room };
  }

  proposeTrade(socketId, toId, offerCardId) {
    const gate = this.requireMyTurn(socketId);
    if (gate.error) return gate;
    const { room, playerId } = gate;
    if (room.pendingTrade) return { error: '이미 거래 제안이 있습니다.' };
    if (!room.players[toId]) return { error: '상대 플레이어가 없습니다.' };
    if (toId === playerId) return { error: '자신과 거래할 수 없습니다.' };
    if (!room.players[toId].connected) return { error: '상대가 접속 중이 아닙니다.' };

    const hand = room.hands[playerId];
    const card = this.findCard(hand, offerCardId);
    if (!card) return { error: '카드가 없습니다.' };

    room.pendingTrade = { fromId: playerId, toId, offerCardId };
    this.pushLog(
      room,
      `${room.players[playerId].name}님이 ${room.players[toId].name}님에게 거래를 제안했습니다.`
    );
    this.touch(room);
    return { room };
  }

  respondTrade(socketId, accept, responseCardId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || ctx.room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    const { room, playerId } = ctx;
    const trade = room.pendingTrade;
    if (!trade || trade.toId !== playerId) return { error: '받을 거래가 없습니다.' };

    if (!accept) {
      this.pushLog(room, `${room.players[playerId].name}님이 거래를 거절했습니다.`);
      room.pendingTrade = null;
      this.touch(room);
      return { room };
    }

    const fromHand = room.hands[trade.fromId];
    const toHand = room.hands[trade.toId];
    const offer = this.findCard(fromHand, trade.offerCardId);
    const response = this.findCard(toHand, responseCardId);
    if (!offer || !response) return { error: '교환할 카드가 유효하지 않습니다.' };

    this.removeCard(fromHand, trade.offerCardId);
    this.removeCard(toHand, responseCardId);
    fromHand.push(response);
    toHand.push(offer);

    this.pushLog(
      room,
      `${room.players[trade.fromId].name} ↔ ${room.players[trade.toId].name} 카드 교환 완료.`
    );
    room.pendingTrade = null;
    this.advanceTurn(room);
    return { room };
  }

  cancelTrade(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || !ctx.room.pendingTrade) return { error: '취소할 거래가 없습니다.' };
    const { room, playerId } = ctx;
    if (room.pendingTrade.fromId !== playerId) return { error: '제안자만 취소할 수 있습니다.' };
    room.pendingTrade = null;
    this.pushLog(room, '거래 제안이 취소되었습니다.');
    this.touch(room);
    return { room };
  }

  useSyringe(socketId, { mode, targetPlayerId, discardIndex }) {
    const gate = this.requireMyTurn(socketId);
    if (gate.error) return gate;
    const { room, playerId } = gate;
    if (room.pendingTrade) return { error: '진행 중인 거래가 있습니다.' };

    const hand = room.hands[playerId];
    const syringeIdx = hand.findIndex((c) => c.type === 'syringe');
    if (syringeIdx === -1) return { error: '주사기 카드가 없습니다.' };
    const syringe = hand.splice(syringeIdx, 1)[0];
    const pname = room.players[playerId].name;

    if (mode === 'discard') {
      if (!room.discardPile.length) {
        hand.push(syringe);
        return { error: '버린 카드 더미가 비어 있습니다.' };
      }
      const di =
        typeof discardIndex === 'number' && discardIndex >= 0 && discardIndex < room.discardPile.length
          ? discardIndex
          : room.discardPile.length - 1;
      const taken = room.discardPile.splice(di, 1)[0];
      const clean = {
        id: taken.id,
        type: taken.type,
        formulaId: taken.formulaId,
        value: taken.value,
        label: taken.label,
        name: taken.name,
        nameEn: taken.nameEn,
        symbol: taken.symbol,
      };
      hand.push(clean);
      room.discardPile.push({ ...syringe, discardedBy: playerId });
      this.pushLog(room, `${pname}님이 주사기로 버린 카드(${clean.label})를 가져갔습니다.`);
      this.advanceTurn(room);
      return { room };
    }

    if (mode === 'steal') {
      if (!targetPlayerId || !room.players[targetPlayerId]) {
        hand.push(syringe);
        return { error: '대상을 선택하세요.' };
      }
      if (targetPlayerId === playerId) {
        hand.push(syringe);
        return { error: '자신에게 쓸 수 없습니다.' };
      }
      const targetHand = room.hands[targetPlayerId];
      if (!targetHand.length) {
        hand.push(syringe);
        return { error: '상대 손패가 비어 있습니다.' };
      }
      const ri = Math.floor(Math.random() * targetHand.length);
      const stolen = targetHand.splice(ri, 1)[0];
      hand.push(stolen);
      targetHand.push(syringe);
      this.pushLog(
        room,
        `${pname}님이 주사기로 ${room.players[targetPlayerId].name}님의 카드를 훔쳤습니다.`
      );
      this.advanceTurn(room);
      return { room };
    }

    hand.push(syringe);
    return { error: '잘못된 주사기 모드입니다.' };
  }

  administer(socketId, guessedFormulaId) {
    const gate = this.requireMyTurn(socketId);
    if (gate.error) return gate;
    const { room, playerId } = gate;
    if (room.pendingTrade) return { error: '진행 중인 거래가 있습니다.' };

    const trueId = room.antidoteFormulaId;
    const winners = [];
    for (const pid of room.order) {
      const hand = room.hands[pid] || [];
      const has = hand.some(
        (c) => (c.type === 'number' || c.type === 'x') && c.formulaId === trueId
      );
      if (has) winners.push(pid);
    }

    room.status = 'ended';
    room.winners = winners;
    room.guessedFormulaId = guessedFormulaId;
    room.administeredBy = playerId;

    const guessOk = guessedFormulaId === trueId;
    const gname = FORMULAS.find((f) => f.id === guessedFormulaId)?.name || guessedFormulaId;
    const tname = FORMULAS.find((f) => f.id === trueId)?.name || trueId;
    this.pushLog(
      room,
      `${room.players[playerId].name}님이 공식 ${gname}로 해독제를 투여했습니다. (실제 해독제: ${tname}${guessOk ? ' ✓' : ' ✗'})`
    );
    const winNames = winners.map((id) => room.players[id]?.name).filter(Boolean);
    this.pushLog(
      room,
      winNames.length
        ? `생존자: ${winNames.join(', ')}`
        : '생존자 없음 — 아무도 해독제 공식 카드를 들고 있지 않았습니다.'
    );
    this.touch(room);
    return { room };
  }

  /** Purge idle empty-ish rooms */
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

  viewForSocket(socketId) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx) return null;
    return this.viewForPlayer(ctx.room, ctx.playerId);
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
    }));

    const myHand = room.hands[playerId] ? [...room.hands[playerId]] : [];
    const eliminated = [];
    for (const c of myHand) {
      if (c.type === 'x' && c.formulaId) eliminated.push(c.formulaId);
    }

    const discardPublic = room.discardPile.map((c) => ({
      id: c.id,
      type: c.type,
      formulaId: c.formulaId,
      value: c.value,
      label: c.label,
    }));

    const base = {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      players: playersPublic,
      turnPlayerId: room.status === 'playing' ? this.currentPlayerId(room) : null,
      isMyTurn: room.status === 'playing' && this.currentPlayerId(room) === playerId,
      myHand,
      discardPile: discardPublic,
      formulas: FORMULAS,
      eliminatedFormulas: [...new Set(eliminated)],
      pendingTrade: room.pendingTrade
        ? {
            fromId: room.pendingTrade.fromId,
            toId: room.pendingTrade.toId,
            fromName: room.players[room.pendingTrade.fromId]?.name,
            toName: room.players[room.pendingTrade.toId]?.name,
            offerCard:
              playerId === room.pendingTrade.fromId || playerId === room.pendingTrade.toId
                ? this.findCard(
                    room.hands[room.pendingTrade.fromId] || [],
                    room.pendingTrade.offerCardId
                  )
                : null,
            amProposer: playerId === room.pendingTrade.fromId,
            amTarget: playerId === room.pendingTrade.toId,
          }
        : null,
      log: room.log.slice(-20),
      me: playerId,
    };

    if (room.status === 'ended') {
      base.antidoteFormulaId = room.antidoteFormulaId;
      base.guessedFormulaId = room.guessedFormulaId;
      base.administeredBy = room.administeredBy;
      base.winners = room.winners;
      base.winnerNames = room.winners.map((id) => room.players[id]?.name).filter(Boolean);
      base.allHands = {};
      for (const id of room.order) {
        base.allHands[id] = room.hands[id] || [];
      }
    }

    return base;
  }
}

function sanitizeName(playerName) {
  return (playerName || 'Player').trim().slice(0, 16) || 'Player';
}

module.exports = { RoomManager, FORMULAS };
