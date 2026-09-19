/**
 * Client-safe guess validation.
 *
 * Split out of word-lists.ts so pages/index.tsx can give typing feedback
 * without dragging that module's `import { randomInt } from 'crypto'` — and
 * with it Next's ~100 KB gz crypto-browserify polyfill — into the client
 * bundle. Nothing in this file may import 'crypto' or any other Node
 * built-in; answer selection stays in word-lists.ts, which the client never
 * imports.
 *
 * The client check is UX only. /api/guess re-validates every submission
 * server-side and remains the authority.
 */

import { WORDS, WORDS_THROUGH_ROUND_35 } from '../data/guess_words_clean';

/**
 * Pre-compute Set for O(1) lookup instead of O(n) includes()
 * CRITICAL: Using includes() on ~4000 words blocks input rendering!
 *
 * This Set is created once at module load time for optimal performance.
 */
const WORDS_SET = new Set(WORDS);

/**
 * The list rounds 1-35 played with, as a Set for the same O(1) reason.
 *
 * TEMPORARY. See WORDS_THROUGH_ROUND_35 in guess_words_clean.ts — this and
 * everything below it can be deleted once round 36 is underway.
 */
const LEGACY_WORDS_SET = new Set(WORDS_THROUGH_ROUND_35);

/**
 * First round that plays with the expanded list.
 *
 * Round 35 was live when the 145 additions landed. Its answer, bonus words
 * and burn words were committed onchain from the smaller list, so a new word
 * could never be the answer in that round, and letting one through would have
 * cost a player a paid guess on a word with no chance.
 */
export const WORD_LIST_EXPANSION_ROUND = 36;

/**
 * Check if a word is a valid guess against the CURRENT list.
 *
 * Use this where no round is in scope: answer-candidate validation at round
 * creation, and the client's optimistic first paint. Anything that decides
 * whether a real guess counts must use isValidGuessForRound.
 */
export function isValidGuess(word: string): boolean {
  const normalized = word.toUpperCase().trim();
  return WORDS_SET.has(normalized);
}

/**
 * Check if a word is a valid guess IN A GIVEN ROUND.
 *
 * roundId is required rather than optional on purpose: an optional one would
 * default some future caller to the wrong era silently, which is exactly how
 * this repo's other era bugs have happened.
 */
export function isValidGuessForRound(word: string, roundId: number): boolean {
  const normalized = word.toUpperCase().trim();
  return wordSetForRound(roundId).has(normalized);
}

/** Every word playable in a given round, for the wheel. */
export function getWordsForRound(roundId: number): string[] {
  return roundId >= WORD_LIST_EXPANSION_ROUND ? [...WORDS] : [...WORDS_THROUGH_ROUND_35];
}

function wordSetForRound(roundId: number): Set<string> {
  return roundId >= WORD_LIST_EXPANSION_ROUND ? WORDS_SET : LEGACY_WORDS_SET;
}
