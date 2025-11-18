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
  seedCapEth: string; // e.g. "0.1"
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
  createdAt: Date;
}

/**
 * Word List Types
 */
export type WordList = string[];

export interface WordLists {
  answerWords: WordList;
  guessWords: WordList;
  seedWords: WordList;
}
