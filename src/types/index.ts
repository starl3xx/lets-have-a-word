/**
 * Game Rules Configuration
 * Defines the ruleset for each round
 */
export interface GameRulesConfig {
  freeGuessesPerDayBase: number;
  clanktonBonusGuesses: number;
  shareBonusGuesses: number;
  paidGuessPackSize: number; // Number of guesses per pack (e.g., 3)
  paidGuessPackPriceEth: string; // Price per pack (e.g., "0.0003")
  maxPaidPacksPerDay: number; // Max packs purchasable per day (e.g., 3)
  maxPaidGuessesPerDay: number; // Derived: packSize × maxPacks (e.g., 9)
  jackpotSplit: {
    winner: number; // 0.8 = 80%
    referrer: number; // 0.1 = 10%
    top10: number; // 0.1 = 10%
  };
  seedCapEth: string; // e.g. "0.03"
  clanktonThreshold: string; // e.g. "100000000"
}

/**
 * Game Rules (from database)
 */
export interface GameRules {
  id: number;
  name: string;
  config: GameRulesConfig;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User
 */
export interface User {
  id: number;
  fid: number; // Farcaster ID
  signerWalletAddress: string | null;
  referrerFid: number | null;
  xp: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Round
 */
export interface Round {
  id: number;
  rulesetId: number;
  answer: string; // 5-letter word (stored securely)
  salt: string; // random salt for commit-reveal
  commitHash: string; // H(salt||answer)
  prizePoolEth: string; // current prize pool
  seedNextRoundEth: string; // accumulated seed for next round
  winnerFid: number | null;
  referrerFid: number | null;
  startedAt: Date;
  resolvedAt: Date | null;
}

/**
 * Guess
 */
export interface Guess {
  id: number;
  roundId: number;
  fid: number;
  word: string; // 5-letter guessed word
  isPaid: boolean;
  isCorrect: boolean; // True if this guess won the round
  createdAt: Date;
}

/**
 * Submit Guess Result Types
 */
export type SubmitGuessResult =
  | { status: 'round_closed' }
  | { status: 'invalid_word'; reason: 'not_5_letters' | 'non_alpha' | 'not_in_dictionary' }
  | { status: 'already_guessed_word'; word: string }
  | { status: 'incorrect'; word: string; totalGuessesForUserThisRound: number }
  | { status: 'correct'; word: string; roundId: number; winnerFid: number }
  | { status: 'no_guesses_left_today' } // Milestone 2.2: Daily limits enforced
  | { status: 'duplicate_ignored'; word: string; message: string } // Milestone 9.6: Idempotent duplicate handling
  | { status: 'rate_limited'; message: string; retryAfterSeconds?: number } // Milestone 9.6: Rate limit soft block
  | { status: 'bonus_word'; word: string; clanktonAmount: string; txHash?: string; message: string }; // Bonus Words feature

/**
 * Submit Guess Parameters
 */
export interface SubmitGuessParams {
  fid: number;
  word: string;
  isPaidGuess?: boolean;
}

/**
 * Top Guesser Stats
 */
export interface TopGuesser {
  fid: number;
  guessCount: number;
  firstGuessAt: Date;
}

/**
 * Word List Types
 * Milestone 4.10: Removed seedWords from model
 */
export type WordList = string[];

export interface WordLists {
  answerWords: WordList;
  guessWords: WordList;
}

/**
 * Wheel Word Status
 * Milestone 4.10: Per-word status for global wheel
 */
export type WheelWordStatus = 'unguessed' | 'wrong' | 'winner';

/**
 * Wheel Word with Status
 * Milestone 4.10: Wheel API returns words with their status
 */
export interface WheelWord {
  word: string;
  status: WheelWordStatus;
}

/**
 * Wheel Response
 * Milestone 4.10: Updated API contract for global wheel
 */
export interface WheelResponse {
  roundId: number;
  totalWords: number;
  words: WheelWord[];
}

/**
 * Dev Mode Types (Milestone 4.8)
 */

// Backend-owned states for dev mode preview
export type DevBackendState =
  | 'SUBMITTING'
  | 'RESULT_CORRECT'
  | 'RESULT_WRONG_VALID'
  | 'OUT_OF_GUESSES';

/**
 * Game State Response (unified state from /api/game)
 * Milestone 4.8: New endpoint for dev mode preview
 */
export interface GameStateResponse {
  roundId: number;
  prizePoolEth: string;
  prizePoolUsd?: string;
  globalGuessCount: number;
  userState: {
    fid: number;
    freeGuessesRemaining: number;
    paidGuessesRemaining: number;
    totalGuessesRemaining: number;
    clanktonBonusActive: boolean;
  };
  wheelWords?: string[]; // Only in dev mode - production uses /api/wheel
  devMode?: boolean;
  devSolution?: string; // Only present in dev mode for testing
  devState?: DevBackendState; // Only present in forced preview mode
  devInput?: string; // Only present in forced preview mode
}

/**
 * XP Event Types
 * Milestone 6.7: Event-sourced XP tracking system
 *
 * All possible XP event types that can be recorded.
 * Some events are tracked but don't award XP (xpAmount = 0) for future use.
 */
export type XpEventType =
  | 'DAILY_PARTICIPATION'   // +10 XP for first valid guess of the day
  | 'GUESS'                 // +2 XP per valid guess
  | 'WIN'                   // +2500 XP for winning the round
  | 'TOP_TEN_GUESSER'       // +50 XP for being in top 10 at round resolution
  | 'REFERRAL_FIRST_GUESS'  // +20 XP when referred user makes first guess
  | 'STREAK_DAY'            // +15 XP for consecutive day playing
  | 'NEAR_MISS'             // 0 XP (tracked for future use)
  | 'CLANKTON_BONUS_DAY'    // +10 XP per day for CLANKTON holders
  | 'SHARE_CAST'            // +15 XP for sharing to Farcaster
  | 'PACK_PURCHASE'         // +20 XP per pack purchase
  | 'OG_HUNTER_AWARD'       // +500 XP for OG Hunter badge (prelaunch campaign)
  | 'BONUS_WORD';           // +250 XP for finding a bonus word (5M CLANKTON)

/**
 * XP Event
 * Milestone 6.7: Represents a single XP-earning event
 */
export interface XpEvent {
  id: number;
  fid: number;
  roundId?: number | null;
  eventType: XpEventType;
  xpAmount: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/**
 * XP Configuration
 * Milestone 6.7: XP values for each event type (v1 defaults)
 */
export const XP_VALUES: Record<XpEventType, number> = {
  DAILY_PARTICIPATION: 10,
  GUESS: 2,
  WIN: 2500,
  TOP_TEN_GUESSER: 50,
  REFERRAL_FIRST_GUESS: 20,
  STREAK_DAY: 15,
  NEAR_MISS: 0,           // Tracked only, no XP in v1
  CLANKTON_BONUS_DAY: 10,
  SHARE_CAST: 15,
  PACK_PURCHASE: 20,
  OG_HUNTER_AWARD: 500,   // OG Hunter badge award (prelaunch campaign)
  BONUS_WORD: 250,        // Finding a bonus word (5M CLANKTON)
};

/**
 * XP Summary Response
 * Milestone 6.7: Response type for XP API endpoint
 */
export interface XpSummaryResponse {
  fid: number;
  totalXp: number;
  recentEvents?: XpEvent[];  // Only in dev mode
}

/**
 * Guess Source State
 * Milestone 6.5: Per-source tracking for unified guess bar
 *
 * Tracks allocations and usage for each guess source:
 * - free: Base daily free guess (always 1)
 * - clankton: CLANKTON holder bonus (0, 2, or 3 depending on mcap)
 * - share: Share bonus (0 or 1, earned by sharing)
 * - paid: Purchased guess packs (0-9, in increments of 3)
 */
export interface GuessSourceState {
  /** Total guesses remaining across all sources */
  totalRemaining: number;

  /** Free guess source (base daily allocation) */
  free: {
    total: number;      // Always 1
    used: number;       // 0 or 1
    remaining: number;  // 0 or 1
  };

  /** CLANKTON holder bonus source */
  clankton: {
    total: number;      // 0, 2, or 3 (0 if not a holder)
    used: number;       // 0 to total
    remaining: number;  // 0 to total
    isHolder: boolean;  // Whether user holds CLANKTON
  };

  /** Share bonus source */
  share: {
    total: number;      // 0 or 1
    used: number;       // 0 or 1
    remaining: number;  // 0 or 1
    hasSharedToday: boolean;  // Whether user has shared today
    canClaimBonus: boolean;   // Whether user can still claim share bonus
  };

  /** Paid guess packs source */
  paid: {
    total: number;      // 0-9 (purchased credits for today)
    used: number;       // 0 to total
    remaining: number;  // 0 to total
    packsPurchased: number;   // 0-3 packs bought today
    maxPacksPerDay: number;   // Usually 3
    canBuyMore: boolean;      // Whether more packs can be purchased
  };
}
