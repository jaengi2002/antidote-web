/**
 * Placebo Effect + Lab Romance expansions (Antidote_번역.pdf).
 * Not used with 2-player silent rules.
 */

const ROMANCE_DEFS = [
  {
    id: 'romeo',
    name: '로미오',
    pair: 'juliet',
    summary: '애인과 둘 다 해독제를. 애인 죽으면 나도 패배. 둘 다 살면 점수 합산.',
  },
  {
    id: 'juliet',
    name: '줄리엣',
    pair: 'romeo',
    summary: '애인(로미오)과 둘 다 해독제를. 둘 다 살면 점수 합산.',
  },
  {
    id: 'hermia',
    name: '헤르미아',
    pair: 'lysander',
    summary: '애인이 해독제를 마시면 생존. 왼쪽 이웃과 마지막 카드 공유(예시 규칙).',
    seatLover: 'left',
  },
  {
    id: 'lysander',
    name: '라이샌더',
    pair: 'hermia',
    summary: '애인(왼쪽 이웃)이 해독제를 마시면 생존 +2.',
    seatLover: 'left',
  },
  {
    id: 'antonio',
    name: '안토니오',
    summary: '나도 살아야 함. 다른 생존자 1명당 +1.',
  },
  {
    id: 'iago',
    name: '이아고',
    summary: '나도 살아야 함. 사망자 1명당 +1.',
  },
  {
    id: 'othello',
    name: '오셀로',
    summary: '나도 살아야 함. 나와 지정 애인만 생존 시 인원수만큼 보너스.',
    needsLoverPick: true,
  },
  {
    id: 'claudius',
    name: '클라우디우스',
    summary: '종료 전 WS에서 뽑은 카드가 마신 약. 손의 원래 마지막 카드 제조법 마신 사람 수만큼 +1.',
    needsWsPick: true,
  },
];

/** 표 5 – 플라시보 세팅 추가 카드 */
function table5(humanCount) {
  const n = humanCount;
  if (n <= 3) return { placebos: 2, clinicals: 1, extraSyringes: 0 };
  if (n === 4) return { placebos: 1, clinicals: 2, extraSyringes: 1 };
  if (n === 5) return { placebos: 2, clinicals: 2, extraSyringes: 1 };
  if (n === 6) return { placebos: 3, clinicals: 3, extraSyringes: 0 };
  return { placebos: 3, clinicals: 3, extraSyringes: 1 }; // 7
}

function makeExpansionCards(t5) {
  const cards = [];
  for (let i = 0; i < t5.placebos; i++) {
    cards.push({
      id: `PLC-${i + 1}`,
      type: 'placebo',
      formulaId: null,
      value: null,
      label: '플라시보',
      name: '플라시보',
      nameEn: 'Placebo',
      symbol: 'bio',
    });
  }
  for (let i = 0; i < t5.clinicals; i++) {
    cards.push({
      id: `CLN-${i + 1}`,
      type: 'clinical',
      formulaId: null,
      value: null,
      label: '임상 실험',
      name: '임상 실험',
      nameEn: 'Clinical Trial',
      symbol: 'molecule',
    });
  }
  for (let i = 0; i < t5.extraSyringes; i++) {
    cards.push({
      id: `SYR-X${i + 1}`,
      type: 'syringe',
      formulaId: null,
      value: null,
      label: '주사기',
      name: '주사기',
      nameEn: 'Syringe',
      symbol: 'syringe',
    });
  }
  return cards;
}

function makeIdBadges(formulaIds) {
  // one badge per formula (7 or 8)
  return formulaIds.map((fid) => ({
    id: `BADGE-${fid}`,
    formulaId: fid,
  }));
}

function makeRomanceDeck() {
  return ROMANCE_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    pair: d.pair || null,
    summary: d.summary,
    seatLover: d.seatLover || null,
    needsLoverPick: !!d.needsLoverPick,
    needsWsPick: !!d.needsWsPick,
  }));
}

function romanceDef(id) {
  return ROMANCE_DEFS.find((r) => r.id === id) || null;
}

/**
 * Full end scoring: base drink → romance → ID badge (romance first per rulebook).
 * @returns {{ scores, winners, survived, notes }}
 */
function computeEndScores(room, formulaById) {
  const trueId = room.antidoteFormulaId;
  const order = room.order;
  const n = order.length;

  // drunk formula / value per player (Claudius may override with WS pick)
  const drunk = {};
  for (const pid of order) {
    const claudiusPick = room.claudiusPicks?.[pid];
    const hand = room.hands[pid] || [];
    const last = hand[0] || null;
    if (claudiusPick?.card) {
      drunk[pid] = {
        card: claudiusPick.card,
        fromClaudius: true,
        handLast: last,
      };
    } else {
      drunk[pid] = { card: last, fromClaudius: false, handLast: last };
    }
  }

  // base survive + base score from drunk card
  const survived = {};
  const baseScore = {};
  for (const pid of order) {
    const c = drunk[pid].card;
    if (!c) {
      survived[pid] = false;
      baseScore[pid] = -1;
    } else if (c.type === 'number') {
      if (c.formulaId === trueId) {
        survived[pid] = true;
        baseScore[pid] = c.value || 0;
      } else {
        survived[pid] = false;
        baseScore[pid] = -(c.value || 0);
      }
    } else if (c.type === 'syringe' || c.type === 'placebo' || c.type === 'clinical') {
      survived[pid] = false;
      baseScore[pid] = -1;
    } else {
      // X etc.
      survived[pid] = false;
      baseScore[pid] = -1;
    }
  }

  // lover map
  function leftOf(pid) {
    const i = order.indexOf(pid);
    if (i < 0) return null;
    return order[(i - 1 + n) % n];
  }

  function loverOf(pid) {
    const rom = room.romance?.[pid];
    if (!rom) return null;
    const def = romanceDef(rom.id);
    if (!def) return null;
    if (def.seatLover === 'left') return leftOf(pid);
    if (def.pair) {
      const partner = order.find((id) => room.romance?.[id]?.id === def.pair);
      return partner || null;
    }
    if (def.needsLoverPick) return room.othelloLovers?.[pid] || null;
    return null;
  }

  // Romance survival overrides (Hermia/Lysander share lover's drink result)
  for (const pid of order) {
    const rom = room.romance?.[pid];
    if (!rom) continue;
    const def = romanceDef(rom.id);
    if (!def) continue;

    if (def.id === 'lysander' || def.id === 'hermia') {
      const lover = loverOf(pid);
      if (lover && survived[lover]) {
        survived[pid] = true;
        // score from lover's card +2
        const lc = drunk[lover].card;
        const v = lc?.type === 'number' ? lc.value || 0 : 0;
        baseScore[pid] = v + 2;
      } else {
        survived[pid] = false;
        const lc = lover ? drunk[lover].card : null;
        const v = lc?.type === 'number' ? lc.value || 0 : 0;
        baseScore[pid] = -v || -1;
      }
    }

    if (def.id === 'romeo' || def.id === 'juliet') {
      const lover = loverOf(pid);
      if (!lover || !survived[lover] || !survived[pid]) {
        // both must survive; if partner fails, you die
        if (!lover || !survived[lover]) {
          survived[pid] = false;
        }
      }
    }
  }

  // Second pass Romeo/Juliet: if either died, both die; if both live sum scores
  for (const pid of order) {
    const rom = room.romance?.[pid];
    if (!rom || (rom.id !== 'romeo' && rom.id !== 'juliet')) continue;
    const lover = loverOf(pid);
    if (!lover) {
      // no partner in play — treat as normal survive already set
      continue;
    }
    if (!survived[pid] || !survived[lover]) {
      survived[pid] = false;
      survived[lover] = false;
    }
  }

  for (const pid of order) {
    const rom = room.romance?.[pid];
    if (!rom || (rom.id !== 'romeo' && rom.id !== 'juliet')) continue;
    const lover = loverOf(pid);
    if (lover && survived[pid] && survived[lover]) {
      const a = drunk[pid].card?.type === 'number' ? drunk[pid].card.value || 0 : 0;
      const b = drunk[lover].card?.type === 'number' ? drunk[lover].card.value || 0 : 0;
      baseScore[pid] = a + b;
    } else if (rom.id === 'romeo' || rom.id === 'juliet') {
      const c = drunk[pid].card;
      if (c?.type === 'number') baseScore[pid] = -(c.value || 0);
      else baseScore[pid] = -1;
    }
  }

  // Antonio / Iago / Othello bonuses (must survive first for their bonus)
  const scores = {};
  const notes = [];
  for (const pid of order) {
    let s = baseScore[pid] ?? 0;
    const rom = room.romance?.[pid];
    if (rom && survived[pid]) {
      if (rom.id === 'antonio') {
        const others = order.filter((id) => id !== pid && survived[id]).length;
        s += others;
        notes.push(`${room.players[pid]?.name}: 안토니오 +${others}`);
      }
      if (rom.id === 'iago') {
        const dead = order.filter((id) => !survived[id]).length;
        s += dead;
        notes.push(`${room.players[pid]?.name}: 이아고 +${dead}`);
      }
      if (rom.id === 'othello') {
        const lover = loverOf(pid);
        const onlyTwo =
          lover &&
          survived[pid] &&
          survived[lover] &&
          order.every((id) => id === pid || id === lover || !survived[id]);
        if (onlyTwo) {
          s += n;
          notes.push(`${room.players[pid]?.name}: 오셀로 +${n}`);
        }
      }
      if (rom.id === 'claudius') {
        const handLast = drunk[pid].handLast;
        if (handLast && (handLast.type === 'number' || handLast.type === 'x')) {
          const fid = handLast.formulaId;
          const count = order.filter((id) => {
            if (id === pid) return false;
            const c = drunk[id].card;
            return c && (c.type === 'number' || c.type === 'x') && c.formulaId === fid;
          }).length;
          s += count;
          notes.push(`${room.players[pid]?.name}: 클라우디우스 +${count}`);
        }
      }
    }
    scores[pid] = s;
  }

  // ID badges (after romance)
  if (room.config?.placebo && room.idBadges) {
    for (const pid of order) {
      const badge = room.idBadges[pid];
      if (!badge) continue;
      const badgeF = badge.formulaId;
      if (badgeF === trueId) {
        // 담당 제조법 = 해독제 → 실패한 사람 1명당 -1
        const fails = order.filter((id) => !survived[id]).length;
        scores[pid] -= fails;
        notes.push(`${room.players[pid]?.name}: ID(해독제 담당) −${fails}`);
      } else {
        // 담당 ≠ 해독제 → 그 제조법 마신 사람마다 그 사람들 -1? 룰: 당신은 그 제조법 마신 모든 플레이어 1점 감점
        // "당신은 당신의 제조법으로 만든 해독약을 마신 모든 플레이어이들 1점을 감점시킵니다"
        // so each player who drank badge formula loses 1 (applied by badge holder effect on them)
        for (const id of order) {
          const c = drunk[id].card;
          if (c && c.type === 'number' && c.formulaId === badgeF) {
            scores[id] -= 1;
          }
        }
        notes.push(`${room.players[pid]?.name}: ID(${formulaById(badgeF)?.name || badgeF}) 피해 분배`);
      }
      // "혹은 살아남으면 0 이하로 안 감" — floor at 0 if survived
      if (survived[pid] && scores[pid] < 0) scores[pid] = 0;
    }
  }

  const winners = order.filter((id) => survived[id]);
  const scoreMap = {};
  for (const pid of order) {
    scoreMap[pid] = {
      score: scores[pid],
      lastCard: drunk[pid].card,
      survived: !!survived[pid],
      romance: room.romance?.[pid] || null,
      badge: room.idBadges?.[pid] || null,
    };
  }
  return { scores: scoreMap, winners, survived, notes };
}

module.exports = {
  ROMANCE_DEFS,
  table5,
  makeExpansionCards,
  makeIdBadges,
  makeRomanceDeck,
  romanceDef,
  computeEndScores,
};
