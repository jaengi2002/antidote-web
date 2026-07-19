/**
 * Antidote-style deck (learning clone of Bellwether Games rules).
 * Seven toxin formulas: number ranks + one X each. One X is the sealed antidote.
 */

const FORMULAS = [
  {
    id: 'A',
    code: 'A',
    name: '적철독',
    nameEn: 'Ferric',
    color: '#8B1E1E',
    colorSoft: '#F5E6E6',
    ink: '#4A0F0F',
    symbol: 'skull',
  },
  {
    id: 'B',
    code: 'B',
    name: '청람독',
    nameEn: 'Azure',
    color: '#1B4F72',
    colorSoft: '#E6F0F5',
    ink: '#0D2A3D',
    symbol: 'drop',
  },
  {
    id: 'C',
    code: 'C',
    name: '녹청독',
    nameEn: 'Viridian',
    color: '#1E6B3A',
    colorSoft: '#E6F5EC',
    ink: '#0D3A1C',
    symbol: 'leaf',
  },
  {
    id: 'D',
    code: 'D',
    name: '호박독',
    nameEn: 'Amber',
    color: '#8B6914',
    colorSoft: '#F7F1DE',
    ink: '#4A3808',
    symbol: 'bio',
  },
  {
    id: 'E',
    code: 'E',
    name: '자정독',
    nameEn: 'Violet',
    color: '#5B2C6F',
    colorSoft: '#F0E6F5',
    ink: '#2E1538',
    symbol: 'crystal',
  },
  {
    id: 'F',
    code: 'F',
    name: '주황독',
    nameEn: 'Rust',
    color: '#A04000',
    colorSoft: '#F8EBE0',
    ink: '#5A2400',
    symbol: 'flame',
  },
  {
    id: 'G',
    code: 'G',
    name: '청록독',
    nameEn: 'Teal',
    color: '#0E6655',
    colorSoft: '#E0F5F1',
    ink: '#063D33',
    symbol: 'molecule',
  },
];

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

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function syringeCount(playerCount) {
  if (playerCount <= 2) return 2;
  if (playerCount === 3) return 3;
  if (playerCount === 4) return 4;
  if (playerCount === 5) return 5;
  return 6;
}

function setupGame(playerIds) {
  const n = playerIds.length;
  if (n < 2 || n > 6) {
    throw new Error('플레이어는 2~6명이어야 합니다.');
  }

  const xCards = FORMULAS.map((f) => ({
    id: `X-${f.id}`,
    type: 'x',
    formulaId: f.id,
    value: null,
    label: cardLabel('x', f.id),
    name: f.name,
    nameEn: f.nameEn,
    symbol: f.symbol,
  }));

  const shuffledX = shuffle(xCards);
  const antidoteCard = shuffledX[0];
  const remainingX = shuffledX.slice(1);

  const maxNum = Math.min(6, Math.max(3, n));
  const numberCards = [];
  for (const f of FORMULAS) {
    for (let v = 1; v <= maxNum; v++) {
      numberCards.push({
        id: `${f.id}-${v}`,
        type: 'number',
        formulaId: f.id,
        value: v,
        label: cardLabel('number', f.id, v),
        name: f.name,
        nameEn: f.nameEn,
        symbol: f.symbol,
      });
    }
  }

  const syringes = [];
  for (let i = 0; i < syringeCount(n); i++) {
    syringes.push({
      id: `SYR-${i + 1}`,
      type: 'syringe',
      formulaId: null,
      value: null,
      label: '주사기',
      name: '주사기',
      nameEn: 'Syringe',
      symbol: 'syringe',
    });
  }

  const seed = shuffle([...remainingX, ...syringes]);
  const hands = {};
  for (const pid of playerIds) hands[pid] = [];

  let idx = 0;
  for (let round = 0; round < 2; round++) {
    for (const pid of playerIds) {
      if (seed[idx]) {
        hands[pid].push(seed[idx]);
        idx += 1;
      }
    }
  }
  const leftoverSeed = seed.slice(idx);
  const deck = shuffle([...leftoverSeed, ...numberCards]);
  idx = 0;
  while (idx < deck.length) {
    for (const pid of playerIds) {
      if (idx >= deck.length) break;
      hands[pid].push(deck[idx]);
      idx += 1;
    }
  }

  return {
    antidoteFormulaId: antidoteCard.formulaId,
    hands,
    discardPile: [],
    formulas: FORMULAS,
  };
}

module.exports = {
  FORMULAS,
  formulaById,
  cardLabel,
  shuffle,
  setupGame,
};
