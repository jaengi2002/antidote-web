# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).with_name("game") / "roomManager.js"
text = p.read_text(encoding="utf-8")

start = text.find("  /** 임상 실험 방향: left | right | self */")
if start < 0:
    start = text.find("  clinicalChooseDirection(socketId, direction) {")
end = text.find("  placeboSwap(socketId, { handCardId, workstationIndex }) {")
if start < 0 or end < 0:
    raise SystemExit(f"markers not found start={start} end={end}")

new = r'''  clinicalSourceId(room, pid, direction) {
    const order = room.order;
    const n = order.length;
    const i = order.indexOf(pid);
    if (direction === 'left') return order[(i - 1 + n) % n];
    if (direction === 'right') return order[(i + 1) % n];
    return pid;
  }

  clinicalOptions(room, pid, direction) {
    const srcId = this.clinicalSourceId(room, pid, direction);
    const ws = room.workstations[srcId] || [];
    return ws
      .map((s, idx) => ({ idx, card: s.card, faceUp: s.faceUp, srcId }))
      .filter((o) => o.card.type !== 'clinical');
  }

  /** 임상 실험 방향 후 각자 카드 선택 */
  clinicalChooseDirection(socketId, direction) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || ctx.room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    const { room, playerId } = ctx;
    const p = room.pending;
    if (!p || p.type !== 'clinicalDirection') return { error: '임상 실험 단계가 아닙니다.' };
    if (p.playerId !== playerId) return { error: '임상 실험 선언자만 방향을 정합니다.' };
    if (!['left', 'right', 'self'].includes(direction)) return { error: 'left | right | self' };

    const need = [];
    const sources = {};
    for (const pid of room.order) {
      const opts = this.clinicalOptions(room, pid, direction);
      if (opts.length) {
        need.push(pid);
        sources[pid] = this.clinicalSourceId(room, pid, direction);
      }
    }
    if (!need.length) {
      this.pushLog(room, '임상 실험: 가져올 카드가 없어 넘어갑니다.');
      room.pending = null;
      this.advanceTurn(room);
      return { room };
    }
    room.pending = {
      type: 'clinicalPick',
      direction,
      need: need.slice(),
      sources,
      selections: {},
    };
    this.pushLog(
      room,
      '임상 실험: ' +
        (direction === 'left' ? '왼쪽' : direction === 'right' ? '오른쪽' : '본인') +
        ' 내 앞에서 각자 카드를 고르세요.'
    );
    this.touch(room);
    return { room };
  }

  clinicalPickCard(socketId, workstationIndex) {
    const ctx = this.getPlayerBySocket(socketId);
    if (!ctx || ctx.room.status !== 'playing') return { error: '게임 중이 아닙니다.' };
    const { room, playerId } = ctx;
    const p = room.pending;
    if (!p || p.type !== 'clinicalPick') return { error: '임상 선택 단계가 아닙니다.' };
    if (!p.need.includes(playerId)) return { error: '선택할 카드가 없습니다.' };
    if (p.selections[playerId] != null) return { error: '이미 선택했습니다.' };
    const opts = this.clinicalOptions(room, playerId, p.direction);
    if (!opts.some((o) => o.idx === workstationIndex)) return { error: '그 카드는 고를 수 없습니다.' };
    p.selections[playerId] = workstationIndex;
    this.touch(room);
    this.tryResolveClinicalPick(room);
    return { room };
  }

  tryResolveClinicalPick(room) {
    const p = room.pending;
    if (!p || p.type !== 'clinicalPick') return;
    const needReady = p.need.filter((id) => room.players[id]?.connected || room.players[id]?.isBot);
    if (!needReady.every((id) => p.selections[id] != null)) return;
    for (const id of p.need) {
      if (p.selections[id] == null) {
        const opts = this.clinicalOptions(room, id, p.direction);
        if (opts.length) p.selections[id] = opts[0].idx;
      }
    }
    const moves = Object.keys(p.selections).map((pid) => ({
      pid,
      srcId: p.sources[pid],
      wi: p.selections[pid],
    }));
    moves.sort((a, b) => {
      if (a.srcId !== b.srcId) return String(a.srcId).localeCompare(String(b.srcId));
      return b.wi - a.wi;
    });
    for (const m of moves) {
      const ws = room.workstations[m.srcId] || [];
      if (m.wi < 0 || m.wi >= ws.length) continue;
      if (ws[m.wi].card.type === 'clinical') continue;
      const [taken] = ws.splice(m.wi, 1);
      if (!room.hands[m.pid]) room.hands[m.pid] = [];
      room.hands[m.pid].push(taken.card);
      if (taken.card.type === 'placebo' && this.isHuman(m.srcId)) {
        this.triggerPlaceboReveal(room, m.srcId, m.pid);
      }
    }
    this.pushLog(room, '임상 실험 완료.');
    room.pending = null;
    this.advanceTurn(room);
  }

  triggerPlaceboReveal(room, ownerId, stealerId) {
    this.pushLog(
      room,
      `${room.players[ownerId]?.name || '?'}님의 속임수 약이 훔쳐졌습니다! (손↔내 앞 교환 가능)`
    );
    room.pendingPlaceboSwap = { playerId: ownerId, stealerId };
  }

'''

text = text[:start] + new + text[end:]
# quieter some logs
text = text.replace(
    "방향 선택 (left / right / self WS)",
    "방향을 고르세요",
)
p.write_text(text, encoding="utf-8")
print("patched", p)
