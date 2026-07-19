/**
 * Antidote-style deck (learning clone of Bellwether Games rules).
 * Formulas: 7 colors, each with number cards 1..N and one X (toxin marker).
 * One X is the hidden antidote; remaining X + syringes seed hands.
 */

const FORMULAS = [
  { id: 'A', name: 'A', color: '#e74c3c' },
  { id: 'B', name: 'B', color: '#3498db' },
  { id: 'C', name: 'C', color: '#2ecc71' },
  { id: 'D', name: 'D', color: '#f1c40f' },
  { id: 'E', name: 'E', color: '#9b59b6' },
  { id: 'F', name: 'F', color: '#e67e22' },
  { id: 'G', name: 'G', color: '#1abc9c' },
];

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Number of syringe cards by player count (approx. rulebook scaling). */
function syringeCount(playerCount) {
  if (playerCount <= 2) return 2;
  if (playerCount === 3) return 3;
  if (playerCount === 4) return 4;
  if (playerCount === 5) return 5;
  return 6;
}

/**
 * Build and deal for 2–6 players.
 * Returns { antidoteFormulaId, hands: { [playerId]: Card[] }, discardPile: [] }
 */
function setupGame(playerIds) {
  const n = playerIds.length;
  if (n < 2 || n > 6) {
    throw new Error('플레이어는 2~6명이어야 합니다.');
  }

  // X cards: one per formula
  const xCards = FORMULAS.map((f) => ({
    id: `X-${f.id}`,
    type: 'x',
    formulaId: f.id,
    label: `${f.name}-X`,
  }));

  const shuffledX = shuffle(xCards);
  const antidoteCard = shuffledX[0];
  const remainingX = shuffledX.slice(1);

  // Number cards 1..playerCount for each formula (rule variants use 1–6; scale by seats)
  const maxNum = Math.min(6, Math.max(3, n));
  const numberCards = [];
  for (const f of FORMULAS) {
    for (let v = 1; v <= maxNum; v++) {
      numberCards.push({
        id: `${f.id}-${v}`,
        type: 'number',
        formulaId: f.id,
        value: v,
        label: `${f.name}${v}`,
      });
    }
  }

  const syringes = [];
  for (let i = 0; i < syringeCount(n); i++) {
    syringes.push({
      id: `SYR-${i + 1}`,
      type: 'syringe',
      formulaId: null,
      label: '주사기',
    });
  }

  // Deal 2 cards each from remaining X + syringes (as in rulebook intro deal)
  const seed = shuffle([...remainingX, ...syringes]);
  const hands = {};
  for (const pid of playerIds) {
    hands[pid] = [];
  }

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

  // Rest of deck: leftover seed + all number cards, deal evenly then remainder to deck/discard empty
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
  shuffle,
  setupGame,
};
