/**
 * Antidote setup from Korean rulebook (Antidote_번역.pdf).
 * Base: up to 8 formulas (Agent-U at 7p), numbers 1–7, syringes.
 * Table 1 player counts 2–7 with starting hand sizes.
 */

const FORMULAS = [
  { id: 'A', code: 'A', name: '해골', nameEn: 'Skull', color: '#8B1E1E', colorSoft: '#F5E6E6', ink: '#4A0F0F', symbol: 'skull' },
  { id: 'B', code: 'B', name: '물방울', nameEn: 'Drop', color: '#1B4F72', colorSoft: '#E6F0F5', ink: '#0D2A3D', symbol: 'drop' },
  { id: 'C', code: 'C', name: '이파리', nameEn: 'Leaf', color: '#1E6B3A', colorSoft: '#E6F5EC', ink: '#0D3A1C', symbol: 'leaf' },
  { id: 'D', code: 'D', name: '위험', nameEn: 'Hazard', color: '#8B6914', colorSoft: '#F7F1DE', ink: '#4A3808', symbol: 'bio' },
  { id: 'E', code: 'E', name: '수정', nameEn: 'Crystal', color: '#5B2C6F', colorSoft: '#F0E6F5', ink: '#2E1538', symbol: 'crystal' },
  { id: 'F', code: 'F', name: '불꽃', nameEn: 'Flame', color: '#A04000', colorSoft: '#F8EBE0', ink: '#5A2400', symbol: 'flame' },
  { id: 'G', code: 'G', name: '분자', nameEn: 'Molecule', color: '#0E6655', colorSoft: '#E0F5F1', ink: '#063D33', symbol: 'molecule' },
  // 7인 전용 8번째 (Agent-U). 2–6인이면 미사용.
  { id: 'U', code: 'U', name: '유령', nameEn: 'Ghost', color: '#4A5568', colorSoft: '#E8ECF0', ink: '#1A202C', symbol: 'molecule' },
];

/**
 * 표 1 - 세팅
 * 플레이어 수 | 포뮬러 수 | 제조법당 숫자 | 주사기 | 시작 핸드
 */
function table1(humanCount) {
  // 2인은 3인 구성으로 준비 + 투명 플레이어 (규칙서)
  const n = humanCount === 2 ? 3 : humanCount;
  if (n <= 3) return { formulas: 7, maxNumber: 3, syringes: 3, seedDeal: humanCount === 3 ? 3 : 2, handSize: 10, seats: n };
  if (n === 4) return { formulas: 7, maxNumber: 4, syringes: 2, seedDeal: 2, handSize: 9, seats: 4 };
  if (n === 5) return { formulas: 7, maxNumber: 5, syringes: 4, seedDeal: 2, handSize: 9, seats: 5 };
  if (n === 6) return { formulas: 7, maxNumber: 6, syringes: 6, seedDeal: 2, handSize: 9, seats: 6 };
  // 7
  return { formulas: 8, maxNumber: 7, syringes: 7, seedDeal: 2, handSize: 10, seats: 7 };
}

function formulaById(id) {
  return FORMULAS.find((f) => f.id === id) || null;
}

function activeFormulas(formulaCount) {
  return FORMULAS.slice(0, formulaCount);
}

function cardLabel(type, formulaId, value) {
  const f = formulaById(formulaId);
  if (type === 'syringe') return '주사';
  if (type === 'placebo') return '속임수 약';
  if (type === 'clinical') return '임상 실험';
  if (!f) return '?';
  if (type === 'x') return `${f.name} X`;
  return `${f.name} ${value}`;
}

function makeCard(partial) {
  const f = partial.formulaId ? formulaById(partial.formulaId) : null;
  const typeName =
    partial.type === 'syringe'
      ? '주사'
      : partial.type === 'placebo'
        ? '속임수 약'
        : partial.type === 'clinical'
          ? '임상 실험'
          : null;
  return {
    id: partial.id,
    type: partial.type,
    formulaId: partial.formulaId ?? null,
    value: partial.value ?? null,
    label: partial.label || cardLabel(partial.type, partial.formulaId, partial.value),
    name: typeName || f?.name || partial.name,
    nameEn:
      partial.type === 'syringe'
        ? 'Syringe'
        : partial.type === 'placebo'
          ? 'Fake Med'
          : partial.type === 'clinical'
            ? 'Trial'
            : f?.nameEn || partial.nameEn,
    symbol:
      partial.type === 'syringe'
        ? 'syringe'
        : partial.type === 'placebo'
          ? 'bio'
          : partial.type === 'clinical'
            ? 'molecule'
            : f?.symbol || partial.symbol,
  };
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @param {string[]} humanIds - real player ids (2–7)
 * @param {{ placebo?: boolean, romance?: boolean }} [options]
 */
function setupGame(humanIds, options = {}) {
  const {
    table5,
    makeExpansionCards,
    makeIdBadges,
    makeRomanceDeck,
  } = require('./expansions');

  const humans = humanIds.length;
  if (humans < 2 || humans > 7) throw new Error('플레이어는 2~7명이어야 합니다.');

  const cfg = table1(humans);
  const formulas = activeFormulas(cfg.formulas);
  const silentMode = humans === 2;
  // 확장: 2인(투명) 규칙과 동시 사용 금지 (룰북)
  const placeboOn = !!options.placebo && !silentMode;
  const romanceOn = !!options.romance && !silentMode;
  const seatIds = silentMode ? [...humanIds, '__SILENT__'] : [...humanIds];

  // 1–2. X 분리, 하나 봉인
  const xCards = formulas.map((f) => makeCard({ id: `X-${f.id}`, type: 'x', formulaId: f.id }));
  const shuffledX = shuffle(xCards);
  const antidoteCard = shuffledX[0];
  const remainingX = shuffledX.slice(1);

  // 3. 기본 주사기 + 남은 X 시드 (표5 추가 주사기는 숫자 덱에 섞음)
  const baseSyringes = [];
  for (let i = 0; i < cfg.syringes; i++) {
    baseSyringes.push(makeCard({ id: `SYR-${i + 1}`, type: 'syringe', label: '주사', name: '주사' }));
  }
  const seedPool = shuffle([...remainingX, ...baseSyringes]);
  const hands = {};
  for (const id of seatIds) hands[id] = [];

  let idx = 0;
  if (silentMode) {
    for (let r = 0; r < 2; r++) {
      for (const id of seatIds) {
        if (idx < seedPool.length) hands[id].push(seedPool[idx++]);
      }
    }
  } else {
    for (let r = 0; r < cfg.seedDeal; r++) {
      for (const id of seatIds) {
        if (idx < seedPool.length) hands[id].push(seedPool[idx++]);
      }
    }
  }
  const leftoverSeed = seedPool.slice(idx);

  // 4. 숫자 카드 + (플라시보 시) 표5 카드
  const numberCards = [];
  for (const f of formulas) {
    for (let v = 1; v <= cfg.maxNumber; v++) {
      numberCards.push(makeCard({ id: `${f.id}-${v}`, type: 'number', formulaId: f.id, value: v }));
    }
  }

  let expansionInDeck = [];
  let idBadges = {};
  if (placeboOn) {
    const t5 = table5(humans);
    expansionInDeck = makeExpansionCards(t5);
    const badges = shuffle(makeIdBadges(formulas.map((f) => f.id)));
    const assigned = badges.slice(0, humans);
    humanIds.forEach((pid, i) => {
      idBadges[pid] = assigned[i] || null;
    });
  }

  const rest = shuffle([...leftoverSeed, ...numberCards, ...expansionInDeck]);
  idx = 0;
  let guard = 0;
  const targetHand = cfg.handSize;
  while (idx < rest.length && guard < 800) {
    guard += 1;
    let dealt = false;
    for (const id of seatIds) {
      if (idx >= rest.length) break;
      if (hands[id].length < targetHand) {
        hands[id].push(rest[idx++]);
        dealt = true;
      }
    }
    if (!dealt) {
      for (const id of seatIds) {
        if (idx >= rest.length) break;
        hands[id].push(rest[idx++]);
        dealt = true;
      }
    }
    if (!dealt) break;
  }

  const sizes = seatIds.map((id) => hands[id].length);
  if (new Set(sizes).size !== 1) {
    const min = Math.min(...sizes);
    for (const id of seatIds) {
      while (hands[id].length > min) rest.push(hands[id].pop());
    }
  }

  const workstations = {};
  for (const id of seatIds) workstations[id] = [];

  let romanceDeck = [];
  if (romanceOn) romanceDeck = shuffle(makeRomanceDeck());

  return {
    antidoteFormulaId: antidoteCard.formulaId,
    hands,
    workstations,
    formulas,
    idBadges,
    romanceDeck,
    config: {
      ...cfg,
      humanCount: humans,
      silentMode,
      silentId: silentMode ? '__SILENT__' : null,
      playerCount: humans,
      placebo: placeboOn,
      romance: romanceOn,
      syringes: cfg.syringes,
    },
    seatIds,
  };
}

module.exports = {
  FORMULAS,
  formulaById,
  activeFormulas,
  cardLabel,
  makeCard,
  shuffle,
  table1,
  setupGame,
};
