/**
 * Official-style Antidote (Bellwether / Dennis Hoyle) deck & setup.
 * Contents: 42 number cards (1–6 × 7 formulas), 7 X, 6 syringes.
 * Player count scales numbers & syringes per rulebook Table 1.
 */

const FORMULAS = [
  { id: 'A', code: 'A', name: '적철독', nameEn: 'Ferric', color: '#8B1E1E', colorSoft: '#F5E6E6', ink: '#4A0F0F', symbol: 'skull' },
  { id: 'B', code: 'B', name: '청람독', nameEn: 'Azure', color: '#1B4F72', colorSoft: '#E6F0F5', ink: '#0D2A3D', symbol: 'drop' },
  { id: 'C', code: 'C', name: '녹청독', nameEn: 'Viridian', color: '#1E6B3A', colorSoft: '#E6F5EC', ink: '#0D3A1C', symbol: 'leaf' },
  { id: 'D', code: 'D', name: '호박독', nameEn: 'Amber', color: '#8B6914', colorSoft: '#F7F1DE', ink: '#4A3808', symbol: 'bio' },
  { id: 'E', code: 'E', name: '자정독', nameEn: 'Violet', color: '#5B2C6F', colorSoft: '#F0E6F5', ink: '#2E1538', symbol: 'crystal' },
  { id: 'F', code: 'F', name: '주황독', nameEn: 'Rust', color: '#A04000', colorSoft: '#F8EBE0', ink: '#5A2400', symbol: 'flame' },
  { id: 'G', code: 'G', name: '청록독', nameEn: 'Teal', color: '#0E6655', colorSoft: '#E0F5F1', ink: '#063D33', symbol: 'molecule' },
];

/** Rulebook Table 1 */
function table1(playerCount) {
  const n = playerCount;
  if (n <= 3) return { maxNumber: 3, syringes: 3, seedDeal: n === 3 ? 3 : 2 };
  if (n === 4) return { maxNumber: 4, syringes: 2, seedDeal: 2 };
  if (n === 5) return { maxNumber: 5, syringes: 4, seedDeal: 2 };
  // 6
  return { maxNumber: 6, syringes: 6, seedDeal: 2 };
}

function formulaById(id) {
  return FORMULAS.find((f) => f.id === id) || null;
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
 * Full setup per rulebook pages 1:
 * 1–2: one X sealed as antidote
 * 4: syringes + remaining X, deal seedDeal each
 * 6: number cards 1..maxNumber per formula, deal all evenly
 */
function setupGame(playerIds) {
  const n = playerIds.length;
  if (n < 2 || n > 6) throw new Error('플레이어는 2~6명이어야 합니다.');

  const { maxNumber, syringes: syringeN, seedDeal } = table1(n);

  const xCards = FORMULAS.map((f) =>
    makeCard({ id: `X-${f.id}`, type: 'x', formulaId: f.id })
  );
  const shuffledX = shuffle(xCards);
  const antidoteCard = shuffledX[0];
  const remainingX = shuffledX.slice(1);

  const syringes = [];
  for (let i = 0; i < syringeN; i++) {
    syringes.push(makeCard({ id: `SYR-${i + 1}`, type: 'syringe' }));
  }

  const seedPool = shuffle([...remainingX, ...syringes]);
  const hands = {};
  for (const pid of playerIds) hands[pid] = [];

  let idx = 0;
  for (let r = 0; r < seedDeal; r++) {
    for (const pid of playerIds) {
      if (idx < seedPool.length) {
        hands[pid].push(seedPool[idx++]);
      }
    }
  }
  const leftoverSeed = seedPool.slice(idx);

  const numberCards = [];
  for (const f of FORMULAS) {
    for (let v = 1; v <= maxNumber; v++) {
      numberCards.push(
        makeCard({ id: `${f.id}-${v}`, type: 'number', formulaId: f.id, value: v })
      );
    }
  }

  const rest = shuffle([...leftoverSeed, ...numberCards]);
  idx = 0;
  while (idx < rest.length) {
    for (const pid of playerIds) {
      if (idx >= rest.length) break;
      hands[pid].push(rest[idx++]);
    }
  }

  const workstations = {};
  for (const pid of playerIds) workstations[pid] = [];

  return {
    antidoteFormulaId: antidoteCard.formulaId,
    hands,
    workstations,
    formulas: FORMULAS,
    config: { maxNumber, syringeN, seedDeal, playerCount: n },
  };
}

module.exports = {
  FORMULAS,
  formulaById,
  cardLabel,
  makeCard,
  shuffle,
  table1,
  setupGame,
};
