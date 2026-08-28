/**
 * WordmarkType => ERC-1155 token id.
 *
 * THESE NUMBERS ARE PERMANENT. Once the contract is deployed and anybody has
 * minted, a token id means whatever it meant at mint time, forever. Renumbering
 * would silently re-label every token already in a wallet: the holder of "1"
 * would find their Side Quest had become something else. There is no migration
 * for that, because the tokens are soulbound and cannot be recalled.
 *
 * So the map is written out literally rather than derived from the order of
 * WORDMARK_DEFINITIONS. Deriving it would mean an innocent reordering of an
 * object literal, the sort of thing nobody reviews, quietly changed what twelve
 * onchain ids referred to.
 *
 * ADDING a Wordmark is safe: give it the next unused id. CHANGING or REUSING
 * one is not, ever, including for a type that was removed.
 *
 * DELIBERATELY IMPORT-FREE except for a type. `import type` erases at compile
 * time, so this module can be pulled into a client component without dragging
 * the database layer into the browser bundle, which is what broke the
 * production build on PR #291.
 */

import type { WordmarkType } from '../db/schema';

export const WORDMARK_TOKEN_IDS: Readonly<Record<WordmarkType, number>> = Object.freeze({
  OG_HUNTER: 0,
  BONUS_WORD_FINDER: 1,
  JACKPOT_WINNER: 2,
  DOUBLE_W: 3,
  PATRON: 4,
  QUICKDRAW: 5,
  ENCYCLOPEDIC: 6,
  BAKERS_DOZEN: 7,
  BURN_WORD_FINDER: 8,
  SHOWSTOPPER: 9,
  EARLY_ADOPTER: 10,
  TRAILBLAZER: 11,
});

/** Reverse lookup, built once from the map above so the two cannot disagree. */
const BY_ID: Readonly<Record<number, WordmarkType>> = Object.freeze(
  Object.fromEntries(
    Object.entries(WORDMARK_TOKEN_IDS).map(([type, id]) => [id, type as WordmarkType])
  ) as Record<number, WordmarkType>
);

export function tokenIdFor(type: WordmarkType): number {
  return WORDMARK_TOKEN_IDS[type];
}

/** null rather than a throw: the id arrives from a URL and may be anything. */
export function wordmarkTypeForTokenId(id: number): WordmarkType | null {
  if (!Number.isInteger(id)) return null;
  return BY_ID[id] ?? null;
}

/** mint(uint256,address,uint256,uint256,bytes) on the Wordmarks contract. */
export const WORDMARK_MINT_ABI = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'fid', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

/** mintedByFid(uint256,uint256) — the onchain truth about what is already claimed. */
export const WORDMARK_MINTED_ABI = [
  {
    type: 'function',
    name: 'mintedByFid',
    stateMutability: 'view',
    inputs: [
      { name: 'fid', type: 'uint256' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
