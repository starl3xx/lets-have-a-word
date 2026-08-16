// Real 5-letter words for the wheel's "wrong guesses" cascade. The winning word
// is dropped in at a deep index so the spin has room to scroll before it lands.
const POOL = [
  'CRANE', 'SLATE', 'HOUSE', 'MOUNT', 'BRAVE', 'GHOST', 'PRICE', 'TRAIN',
  'LIGHT', 'STORM', 'PLANT', 'CHAIR', 'FLAME', 'GRADE', 'SHINE', 'CLOUD',
  'RIVER', 'STONE', 'BLAZE', 'QUICK', 'VOWEL', 'PIXEL', 'ROBOT', 'OCEAN',
  'EAGLE', 'MAGIC', 'TIGER', 'NORTH', 'FROST', 'SPARK', 'DREAM', 'GLOBE',
  'ORBIT', 'PRIME', 'VAULT', 'CHESS', 'AUDIO', 'NINJA', 'SOLAR', 'CROWN',
  'PEARL', 'RAVEN', 'COMET', 'DELTA', 'EMBER',
];

export function buildWheel(winner: string, winnerIndex = 40): { words: string[]; winnerIndex: number } {
  const words = [...POOL];
  // ensure enough lead-in words exist before the winner
  while (words.length <= winnerIndex + 6) words.push(...POOL);
  words[winnerIndex] = winner.toUpperCase();
  return { words, winnerIndex };
}
