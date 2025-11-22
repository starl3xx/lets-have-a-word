import { pgTable, serial, varchar, integer, timestamp, boolean, jsonb, decimal, index, date, unique } from 'drizzle-orm/pg-core';
import type { GameRulesConfig } from '../types';

/**
 * Game Rules Table
 * Stores different rulesets for rounds
 */
export const gameRules = pgTable('game_rules', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  config: jsonb('config').$type<GameRulesConfig>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Users Table
 * Stores player information
 */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  fid: integer('fid').notNull().unique(), // Farcaster ID
  username: varchar('username', { length: 100 }), // Farcaster username
  signerWalletAddress: varchar('signer_wallet_address', { length: 42 }), // Ethereum address
  custodyAddress: varchar('custody_address', { length: 42 }), // Farcaster custody address
  referrerFid: integer('referrer_fid'), // FK to another user's FID
  spamScore: integer('spam_score'), // Neynar spam/trust score (higher = more trustworthy)
  xp: integer('xp').default(0).notNull(),
  hasSeenIntro: boolean('has_seen_intro').default(false).notNull(), // Milestone 4.3: First-time overlay
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  fidIdx: index('users_fid_idx').on(table.fid),
  walletIdx: index('users_wallet_idx').on(table.signerWalletAddress),
}));

/**
 * Rounds Table
 * Stores each game round with commit-reveal data
 */
export const rounds = pgTable('rounds', {
  id: serial('id').primaryKey(),
  rulesetId: integer('ruleset_id').notNull().references(() => gameRules.id),
  answer: varchar('answer', { length: 5 }).notNull(), // The correct word
  salt: varchar('salt', { length: 64 }).notNull(), // Random salt for hashing
  commitHash: varchar('commit_hash', { length: 64 }).notNull(), // H(salt||answer)
  prizePoolEth: decimal('prize_pool_eth', { precision: 20, scale: 18 }).default('0').notNull(),
  seedNextRoundEth: decimal('seed_next_round_eth', { precision: 20, scale: 18 }).default('0').notNull(),
  winnerFid: integer('winner_fid'), // FK to users.fid
  referrerFid: integer('referrer_fid'), // FK to users.fid (winner's referrer)
  isDevTestRound: boolean('is_dev_test_round').default(false).notNull(), // Milestone 4.5: Mid-round test mode flag
  startedAt: timestamp('started_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'), // null until someone wins
}, (table) => ({
  commitHashIdx: index('rounds_commit_hash_idx').on(table.commitHash),
  winnerIdx: index('rounds_winner_fid_idx').on(table.winnerFid),
}));

/**
 * Guesses Table
 * Stores all player guesses
 */
export const guesses = pgTable('guesses', {
  id: serial('id').primaryKey(),
  roundId: integer('round_id').notNull().references(() => rounds.id),
  fid: integer('fid').notNull(), // FK to users.fid
  word: varchar('word', { length: 5 }).notNull(),
  isPaid: boolean('is_paid').default(false).notNull(),
  isCorrect: boolean('is_correct').default(false).notNull(), // True if this guess won the round
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  roundFidIdx: index('guesses_round_fid_idx').on(table.roundId, table.fid),
  roundWordIdx: index('guesses_round_word_idx').on(table.roundId, table.word),
  createdAtIdx: index('guesses_created_at_idx').on(table.createdAt),
  isCorrectIdx: index('guesses_is_correct_idx').on(table.isCorrect),
}));

export type GameRulesRow = typeof gameRules.$inferSelect;
export type GameRulesInsert = typeof gameRules.$inferInsert;

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;

export type RoundRow = typeof rounds.$inferSelect;
export type RoundInsert = typeof rounds.$inferInsert;

export type GuessRow = typeof guesses.$inferSelect;
export type GuessInsert = typeof guesses.$inferInsert;

/**
 * Daily Guess State Table
 * Tracks per-user, per-day guess allocations and usage
 * Milestone 2.2: Daily & bonus mechanics
 * Milestone 4.14: Wheel start position per user per day
 */
export const dailyGuessState = pgTable('daily_guess_state', {
  id: serial('id').primaryKey(),
  fid: integer('fid').notNull(), // FK to users.fid
  date: date('date').notNull(), // UTC date (YYYY-MM-DD)

  // Free guess allocations for this day
  freeAllocatedBase: integer('free_allocated_base').default(0).notNull(), // Base free guesses (usually 1)
  freeAllocatedClankton: integer('free_allocated_clankton').default(0).notNull(), // CLANKTON holder bonus (0 or 3)
  freeAllocatedShareBonus: integer('free_allocated_share_bonus').default(0).notNull(), // Share bonus (0 or 1)
  freeUsed: integer('free_used').default(0).notNull(), // How many free guesses consumed

  // Paid guess state for this day
  paidGuessCredits: integer('paid_guess_credits').default(0).notNull(), // Remaining paid guesses
  paidPacksPurchased: integer('paid_packs_purchased').default(0).notNull(), // How many packs bought today (max 3)

  // Share bonus tracking
  hasSharedToday: boolean('has_shared_today').default(false).notNull(), // Once share detected, set true

  // Wheel start position (Milestone 4.14)
  wheelStartIndex: integer('wheel_start_index'), // Random start index for wheel scroll position
  wheelRoundId: integer('wheel_round_id'), // Round ID this wheel position was generated for (optional)

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one row per user per day
  fidDateUnique: unique('daily_guess_state_fid_date_unique').on(table.fid, table.date),
  // Index for lookups
  fidDateIdx: index('daily_guess_state_fid_date_idx').on(table.fid, table.date),
}));

export type DailyGuessStateRow = typeof dailyGuessState.$inferSelect;
export type DailyGuessStateInsert = typeof dailyGuessState.$inferInsert;

/**
 * Round Seed Words Table
 * Stores seed words (cosmetic "fake guesses") for each round's wheel
 * Milestone 2.3: Wheel visual state
 */
export const roundSeedWords = pgTable('round_seed_words', {
  id: serial('id').primaryKey(),
  roundId: integer('round_id').notNull().references(() => rounds.id),
  word: varchar('word', { length: 5 }).notNull(), // Uppercase 5-letter seed word
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one occurrence of each seed word per round
  roundWordUnique: unique('round_seed_words_round_word_unique').on(table.roundId, table.word),
  // Index for lookups by round
  roundIdx: index('round_seed_words_round_idx').on(table.roundId),
}));

export type RoundSeedWordRow = typeof roundSeedWords.$inferSelect;
export type RoundSeedWordInsert = typeof roundSeedWords.$inferInsert;

/**
 * System State Table
 * Stores singleton system-wide state (creator balance, etc.)
 * Milestone 3.1: Jackpot + split logic
 */
export const systemState = pgTable('system_state', {
  id: serial('id').primaryKey(),
  creatorBalanceEth: decimal('creator_balance_eth', { precision: 20, scale: 18 }).default('0').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type SystemStateRow = typeof systemState.$inferSelect;
export type SystemStateInsert = typeof systemState.$inferInsert;

/**
 * Round Payouts Table
 * Stores payouts for each round (winner, referrer, top 10 guessers)
 * Milestone 3.1: Jackpot + split logic
 * Milestone 4.9: fid is now nullable for seed and creator payouts
 */
export const roundPayouts = pgTable('round_payouts', {
  id: serial('id').primaryKey(),
  roundId: integer('round_id').notNull().references(() => rounds.id),
  fid: integer('fid'), // FK to users.fid - recipient of payout (null for seed/creator)
  amountEth: decimal('amount_eth', { precision: 20, scale: 18 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(), // 'winner', 'referrer', 'top_guesser', 'seed', 'creator'
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  roundIdx: index('round_payouts_round_idx').on(table.roundId),
  fidIdx: index('round_payouts_fid_idx').on(table.fid),
}));

export type RoundPayoutRow = typeof roundPayouts.$inferSelect;
export type RoundPayoutInsert = typeof roundPayouts.$inferInsert;

/**
 * Announcer Events Table
 * Stores Farcaster announcements to avoid duplicate posts
 * Milestone 5.1: Farcaster announcer bot
 */
export const announcerEvents = pgTable('announcer_events', {
  id: serial('id').primaryKey(),
  eventType: varchar('event_type', { length: 50 }).notNull(), // 'round_started', 'round_resolved', 'jackpot_milestone', etc.
  roundId: integer('round_id').notNull().references(() => rounds.id),
  milestoneKey: varchar('milestone_key', { length: 100 }).notNull().default('default'), // 'default', 'jackpot_0.25', 'guesses_1000', etc.
  payload: jsonb('payload').notNull(), // snapshot of values used for the cast
  castHash: varchar('cast_hash', { length: 100 }), // Farcaster cast hash once posted
  createdAt: timestamp('created_at').defaultNow().notNull(),
  postedAt: timestamp('posted_at'),
}, (table) => ({
  // Unique constraint: one event type per round per milestone
  eventTypeRoundMilestoneUnique: unique('announcer_events_event_type_round_milestone_unique').on(
    table.eventType,
    table.roundId,
    table.milestoneKey
  ),
  // Index for lookups by round
  roundIdx: index('announcer_events_round_idx').on(table.roundId),
  // Index for pending posts (where castHash is null)
  pendingIdx: index('announcer_events_pending_idx').on(table.castHash),
}));

export type AnnouncerEventRow = typeof announcerEvents.$inferSelect;
export type AnnouncerEventInsert = typeof announcerEvents.$inferInsert;
