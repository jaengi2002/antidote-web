/**
 * Antidote setup from Korean rulebook (Antidote_번역.pdf).
 * Base: up to 8 formulas (Agent-U at 7p), numbers 1–7, syringes.
 * Table 1 player counts 2–7 with starting hand sizes.
 */

const FORMULAS = [
  { id: 'A', code: 'A', name: '적철독', nameEn: 'Ferric', color: '#8B1E1E', colorSoft: '#F5E6E6', ink: '#4A0F0F', symbol: 'skull' },
  { id: 'B', code: 'B', name: '청람독', nameEn: 'Azure', color: '#1B4F72', colorSoft: '#E6F0F5', ink: '#0D2A3D', symbol: 'drop' },
  { id: 'C', code: 'C', name: '녹청독', nameEn: 'Viridian', color: '#1E6B3A', colorSoft: '#E6F5EC', ink: '#0D3A1C', symbol: 'leaf' },
  { id: 'D', code: 'D', name: '호박독', nameEn: 'Amber', color: '#8B6914', colorSoft: '#F7F1DE', ink: '#4A3808', symbol: 'bio' },
  { id: 'E', code: 'E', name: '자정독', nameEn: 'Violet', color: '#5B2C6F', colorSoft: '#F0E6F5', ink: '#2E1538', symbol: 'crystal' },
  { id: 'F', code: 'F', name: '주황독', nameEn: 'Rust', color: '#A04000', colorSoft: '#F8EBE0', ink: '#5A2400', symbol: 'flame' },
  { id: 'G', code: 'G', name: '청록독', nameEn: 'Teal', color: '#0E6655', colorSoft: '#E0F5F1', ink: '#063D33', symbol: 'molecule' },
  // 7인 전용 8번째 제조법 (Agent-U). 2–6인이면 상자(미사용).
  { id: 'U', code: 'U', name: 'Agent-U', nameEn: 'Agent-U', color: '#4A5568', colorSoft: '#E8ECF0', ink: '#1A202C', symbol: 'molecule' },
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
  if (type === 'syringe') return '주사기';
  if (!f) return '?';
  if (type === 'x') return `${f.name} X`;
  return `${f.name} ${value}`;
}

function makeCard(partial) {
  const f = partial.formulaId ? formulaById(partial.formulaId) : null;
  return {
    id: partial.id,
    type: partial.type,
    formulaId: partial.formulaId ?? null,
    value: partial.value ?? null,
    label: partial.label || cardLabel(partial.type, partial.formulaId, partial.value),
    name: partial.type === 'syringe' ? '주사기' : f?.name || partial.name,
    nameEn: partial.type === 'syringe' ? 'Syringe' : f?.nameEn || partial.nameEn,
    symbol: partial.type === 'syringe' ? 'syringe' : f?.symbol || partial.symbol,
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
 * @returns setup including optional silentId for 2p
 */
function setupGame(humanIds) {
  const humans = humanIds.length;
  if (humans < 2 || humans > 7) throw new Error('플레이어는 2~7명이어야 합니다.');

  const cfg = table1(humans);
  const formulas = activeFormulas(cfg.formulas);
  const silentMode = humans === 2;
  const seatIds = silentMode ? [...humanIds, '__SILENT__'] : [...humanIds];

  // 1–2. X 분리, 하나 봉인
  const xCards = formulas.map((f) => makeCard({ id: `X-${f.id}`, type: 'x', formulaId: f.id }));
  const shuffledX = shuffle(xCards);
  const antidoteCard = shuffledX[0];
  const remainingX = shuffledX.slice(1);

  // 3. 주사기 + 남은 X, 시드 딜
  const syringes = [];
  for (let i = 0; i < cfg.syringes; i++) {
    syringes.push(makeCard({ id: `SYR-${i + 1}`, type: 'syringe' }));
  }
  const seedPool = shuffle([...remainingX, ...syringes]);
  const hands = {};
  for (const id of seatIds) hands[id] = [];

  let idx = 0;
  const seedEach = silentMode ? 2 : cfg.seedDeal; // 2p: 인간 2장씩, 투명은 아래에서 맞춤
  if (silentMode) {
    // 3인 구성: 시드 풀을 3석에 2장씩 (투명 포함) — 규칙: 3명처럼 준비
    for (let r = 0; r < 2; r++) {
      for (const id of seatIds) {
        if (idx < seedPool.length) hands[id].push(seedPool[idx++]);
      }
    }
  } else {
    for (let r = 0; r < seedEach; r++) {
      for (const id of seatIds) {
        if (idx < seedPool.length) hands[id].push(seedPool[idx++]);
      }
    }
  }
  const leftoverSeed = seedPool.slice(idx);

  // 4. 숫자 카드 1..maxNumber
  const numberCards = [];
  for (const f of formulas) {
    for (let v = 1; v <= cfg.maxNumber; v++) {
      numberCards.push(makeCard({ id: `${f.id}-${v}`, type: 'number', formulaId: f.id, value: v }));
    }
  }

  const rest = shuffle([...leftoverSeed, ...numberCards]);
  // 목표 핸드 크기까지 균등 분배 (표1 시작 핸드)
  idx = 0;
  let guard = 0;
  while (idx < rest.length && guard < 500) {
    guard += 1;
    let dealt = false;
    for (const id of seatIds) {
      if (idx >= rest.length) break;
      if (hands[id].length < cfg.handSize) {
        hands[id].push(rest[idx++]);
        dealt = true;
      }
    }
    if (!dealt) break;
  }

  // 안전: 모두 동일 장수
  const sizes = seatIds.map((id) => hands[id].length);
  if (new Set(sizes).size !== 1) {
    // 남는 카드로 최소 인원부터 맞춤
    const min = Math.min(...sizes);
    for (const id of seatIds) {
      while (hands[id].length > min) {
        rest.push(hands[id].pop());
      }
    }
  }

  const workstations = {};
  for (const id of seatIds) workstations[id] = [];

  return {
    antidoteFormulaId: antidoteCard.formulaId,
    hands,
    workstations,
    formulas,
    config: {
      ...cfg,
      humanCount: humans,
      silentMode,
      silentId: silentMode ? '__SILENT__' : null,
      playerCount: humans,
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
