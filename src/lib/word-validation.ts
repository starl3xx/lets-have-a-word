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

import { WORDS } from '../data/guess_words_clean';

/**
 * Pre-compute Set for O(1) lookup instead of O(n) includes()
 * CRITICAL: Using includes() on ~4000 words blocks input rendering!
 *
 * This Set is created once at module load time for optimal performance.
 */
const WORDS_SET = new Set(WORDS);

/**
 * Check if a word is a valid guess
 * Canonical list is UPPERCASE, so we normalize input to UPPERCASE
 * Uses Set for O(1) lookup instead of O(n) includes()
 */
export function isValidGuess(word: string): boolean {
  const normalized = word.toUpperCase().trim();
  return WORDS_SET.has(normalized);
}
