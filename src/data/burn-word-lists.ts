/**
 * Burn Word Lists
 * Milestone 14: Curated burn-themed words for the burn word system
 *
 * 5 burn words are selected per round from these categories.
 * Discovery permanently destroys $WORD supply (5M per word).
 *
 * All words MUST exist in the master WORDS list (4,438 valid guesses).
 * Validated at module load time.
 */

import { WORDS } from './guess_words_clean';

const WORDS_SET = new Set(WORDS);

/**
 * Fire-themed burn words
 */
const FIRE_THEMED = [
  'FLAME', 'BLAZE', 'EMBER', 'TORCH', 'SCALD',
  'SPARK', 'SINGE', 'FORGE', 'FLARE', 'SMELT',
];

/**
 * Destruction-themed burn words
 */
const DESTRUCTION_THEMED = [
  'CRUSH', 'BLAST', 'CRASH', 'WRECK', 'BREAK',
  'SPLIT', 'CRACK', 'SMASH',
];

/**
 * All burn word candidates (validated at load time)
 */
const ALL_BURN_CANDIDATES = [...FIRE_THEMED, ...DESTRUCTION_THEMED];

/**
 * Validated burn words — only words that exist in the master word list
 */
export const BURN_WORD_CANDIDATES: string[] = ALL_BURN_CANDIDATES.filter(word => {
  const exists = WORDS_SET.has(word.toUpperCase());
  if (!exists) {
    console.warn(`[burn-words] ⚠️ "${word}" not found in master word list, excluded`);
  }
  return exists;
});

// Validate we have enough candidates
if (BURN_WORD_CANDIDATES.length < 5) {
  console.error(
    `[burn-words] CRITICAL: Only ${BURN_WORD_CANDIDATES.length} valid burn words (need at least 5)`
  );
}

console.log(`[burn-words] ${BURN_WORD_CANDIDATES.length}/${ALL_BURN_CANDIDATES.length} burn word candidates validated`);
