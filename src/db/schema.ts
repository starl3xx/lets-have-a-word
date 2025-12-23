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
  userScore: decimal('user_score', { precision: 5, scale: 3 }), // Neynar user quality score (0.0-1.0) - Milestone 5.3
  userScoreUpdatedAt: timestamp('user_score_updated_at'), // Last time user score was fetched - Milestone 5.3
  xp: integer('xp').default(0).notNull(),
  hasSeenIntro: boolean('has_seen_intro').default(false).notNull(), // Milestone 4.3: First-time overlay
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  fidIdx: index('users_fid_idx').on(table.fid),
  walletIdx: index('users_wallet_idx').on(table.signerWalletAddress),
  userScoreUpdatedAtIdx: index('users_user_score_updated_at_idx').on(table.userScoreUpdatedAt),
}));

/**
 * Round Status Types
 * Milestone 9.5: Kill switch and dead day support
 */
export type RoundStatus = 'active' | 'resolved' | 'cancelled';

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
  // Milestone 9.5: Kill switch fields
  status: varchar('status', { length: 20 }).default('active').notNull().$type<RoundStatus>(),
  cancelledAt: timestamp('cancelled_at'),
  cancelledReason: varchar('cancelled_reason', { length: 500 }),
  cancelledBy: integer('cancelled_by'), // Admin FID who triggered kill switch
  refundsStartedAt: timestamp('refunds_started_at'),
  refundsCompletedAt: timestamp('refunds_completed_at'),
}, (table) => ({
  commitHashIdx: index('rounds_commit_hash_idx').on(table.commitHash),
  winnerIdx: index('rounds_winner_fid_idx').on(table.winnerFid),
  statusIdx: index('rounds_status_idx').on(table.status),
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
  guessIndexInRound: integer('guess_index_in_round'), // 1-based index within round (Milestone 7.x: Top-10 lock)
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  roundFidIdx: index('guesses_round_fid_idx').on(table.roundId, table.fid),
  roundWordIdx: index('guesses_round_word_idx').on(table.roundId, table.word),
  createdAtIdx: index('guesses_created_at_idx').on(table.createdAt),
  isCorrectIdx: index('guesses_is_correct_idx').on(table.isCorrect),
  guessIndexIdx: index('guesses_round_guess_index_idx').on(table.roundId, table.guessIndexInRound),
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

/**
 * Analytics Events Table
 * Tracks all logged events in a single fact table
 * Milestone 5.2: Analytics system
 */
export const analyticsEvents = pgTable('analytics_events', {
  id: serial('id').primaryKey(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  userId: varchar('user_id', { length: 100 }), // FID as string for flexibility
  roundId: varchar('round_id', { length: 100 }),
  data: jsonb('data'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  eventTypeIdx: index('analytics_event_type_idx').on(table.eventType),
  userIdIdx: index('analytics_user_id_idx').on(table.userId),
  roundIdIdx: index('analytics_round_id_idx').on(table.roundId),
  createdAtIdx: index('analytics_created_at_idx').on(table.createdAt),
}));

export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect;
export type AnalyticsEventInsert = typeof analyticsEvents.$inferInsert;

/**
 * Round Archive Table
 * Stores historical round data for the archive feature
 * Milestone 5.4: Round archive
 */
export const roundArchive = pgTable('round_archive', {
  id: serial('id').primaryKey(),
  roundNumber: integer('round_number').notNull().unique(), // Maps to rounds.id
  targetWord: varchar('target_word', { length: 5 }).notNull(),
  seedEth: decimal('seed_eth', { precision: 20, scale: 18 }).notNull(), // Starting prize pool (seed from previous round)
  finalJackpotEth: decimal('final_jackpot_eth', { precision: 20, scale: 18 }).notNull(),
  totalGuesses: integer('total_guesses').notNull(),
  uniquePlayers: integer('unique_players').notNull(),
  winnerFid: integer('winner_fid'), // FK to users.fid - nullable if round has no winner
  winnerCastHash: varchar('winner_cast_hash', { length: 100 }), // Farcaster announcement cast hash
  winnerGuessNumber: integer('winner_guess_number'), // Which guess # won the round
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  referrerFid: integer('referrer_fid'), // FK to users.fid (winner's referrer)
  payoutsJson: jsonb('payouts_json').$type<RoundArchivePayouts>().notNull(),
  salt: varchar('salt', { length: 64 }).notNull(), // For verification
  clanktonBonusCount: integer('clankton_bonus_count').notNull().default(0), // Users who got CLANKTON bonus this round
  referralBonusCount: integer('referral_bonus_count').notNull().default(0), // Referral signups this round
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  roundNumberIdx: index('index_round_archive_on_round_number').on(table.roundNumber),
  winnerFidIdx: index('round_archive_winner_fid_idx').on(table.winnerFid),
  startTimeIdx: index('round_archive_start_time_idx').on(table.startTime),
}));

/**
 * Payout structure for round archive
 */
export interface RoundArchivePayouts {
  winner?: { fid: number; amountEth: string };
  referrer?: { fid: number; amountEth: string };
  topGuessers: Array<{ fid: number; amountEth: string; rank: number }>;
  seed?: { amountEth: string };
  creator?: { amountEth: string };
}

export type RoundArchiveRow = typeof roundArchive.$inferSelect;
export type RoundArchiveInsert = typeof roundArchive.$inferInsert;

/**
 * Round Archive Errors Table
 * Stores anomalies and errors encountered during archiving
 * Milestone 5.4: Error handling
 */
export const roundArchiveErrors = pgTable('round_archive_errors', {
  id: serial('id').primaryKey(),
  roundNumber: integer('round_number').notNull(), // The round that had an error
  errorType: varchar('error_type', { length: 100 }).notNull(), // 'missing_winner', 'payout_mismatch', 'data_inconsistency', etc.
  errorMessage: varchar('error_message', { length: 1000 }).notNull(),
  errorData: jsonb('error_data'), // Additional context about the error
  resolved: boolean('resolved').default(false).notNull(),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: integer('resolved_by'), // Admin FID who resolved it
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  roundNumberIdx: index('round_archive_errors_round_number_idx').on(table.roundNumber),
  unresolvedIdx: index('round_archive_errors_unresolved_idx').on(table.resolved),
}));

export type RoundArchiveErrorRow = typeof roundArchiveErrors.$inferSelect;
export type RoundArchiveErrorInsert = typeof roundArchiveErrors.$inferInsert;

/**
 * XP Events Table
 * Milestone 6.7: Event-sourced XP tracking system
 *
 * Stores all XP-earning events for future-proof progression tracking.
 * Total XP is computed by summing xp_amount for a given FID.
 */
export const xpEvents = pgTable('xp_events', {
  id: serial('id').primaryKey(),
  fid: integer('fid').notNull(), // FK to users.fid
  roundId: integer('round_id'), // Nullable - some XP events aren't round-specific
  eventType: varchar('event_type', { length: 50 }).notNull(), // XP event type
  xpAmount: integer('xp_amount').notNull(), // Positive integer, can be 0 for tracked-only events
  metadata: jsonb('metadata').$type<Record<string, unknown>>(), // Optional context data
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  fidCreatedAtIdx: index('xp_events_fid_created_at_idx').on(table.fid, table.createdAt),
  roundIdIdx: index('xp_events_round_id_idx').on(table.roundId),
  eventTypeIdx: index('xp_events_event_type_idx').on(table.eventType),
}));

export type XpEventRow = typeof xpEvents.$inferSelect;
export type XpEventInsert = typeof xpEvents.$inferInsert;

/**
 * Pack Purchases Table
 * Milestone 9.5: Track individual pack purchases for refund support
 */
export const packPurchases = pgTable('pack_purchases', {
  id: serial('id').primaryKey(),
  roundId: integer('round_id').notNull().references(() => rounds.id),
  fid: integer('fid').notNull(),
  packCount: integer('pack_count').default(1).notNull(),
  totalPriceEth: decimal('total_price_eth', { precision: 20, scale: 18 }).notNull(),
  totalPriceWei: varchar('total_price_wei', { length: 78 }).notNull(),
  pricingPhase: varchar('pricing_phase', { length: 20 }).notNull(), // 'BASE', 'LATE_1', 'LATE_2'
  totalGuessesAtPurchase: integer('total_guesses_at_purchase').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  roundIdx: index('pack_purchases_round_idx').on(table.roundId),
  fidIdx: index('pack_purchases_fid_idx').on(table.fid),
  createdAtIdx: index('pack_purchases_created_at_idx').on(table.createdAt),
}));

export type PackPurchaseRow = typeof packPurchases.$inferSelect;
export type PackPurchaseInsert = typeof packPurchases.$inferInsert;

/**
 * Refund Status Types
 * Milestone 9.5: Kill switch refund tracking
 */
export type RefundStatus = 'pending' | 'processing' | 'sent' | 'failed';

/**
 * Refunds Table
 * Milestone 9.5: Track refunds for cancelled rounds
 */
export const refunds = pgTable('refunds', {
  id: serial('id').primaryKey(),
  roundId: integer('round_id').notNull().references(() => rounds.id),
  fid: integer('fid').notNull(),
  amountEth: decimal('amount_eth', { precision: 20, scale: 18 }).notNull(),
  amountWei: varchar('amount_wei', { length: 78 }).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull().$type<RefundStatus>(),
  purchaseIds: integer('purchase_ids').array().notNull(), // Array of pack_purchases.id

  // Transaction tracking
  refundTxHash: varchar('refund_tx_hash', { length: 66 }),
  sentAt: timestamp('sent_at'),
  errorMessage: varchar('error_message', { length: 1000 }),
  retryCount: integer('retry_count').default(0).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  roundIdx: index('refunds_round_idx').on(table.roundId),
  fidIdx: index('refunds_fid_idx').on(table.fid),
  statusIdx: index('refunds_status_idx').on(table.status),
  roundFidUnique: unique('refunds_round_fid_unique').on(table.roundId, table.fid),
}));

export type RefundRow = typeof refunds.$inferSelect;
export type RefundInsert = typeof refunds.$inferInsert;

/**
 * Operational Event Types
 * Milestone 9.5: Audit logging for operational actions
 */
export type OperationalEventType =
  | 'kill_switch_enabled'
  | 'kill_switch_disabled'
  | 'dead_day_enabled'
  | 'dead_day_disabled'
  | 'refunds_started'
  | 'refunds_completed'
  | 'round_cancelled'
  | 'game_resumed';

/**
 * Operational Events Table
 * Milestone 9.5: Audit log for kill switch and dead day actions
 */
export const operationalEvents = pgTable('operational_events', {
  id: serial('id').primaryKey(),
  eventType: varchar('event_type', { length: 50 }).notNull().$type<OperationalEventType>(),
  roundId: integer('round_id').references(() => rounds.id),
  triggeredBy: integer('triggered_by').notNull(), // Admin FID
  reason: varchar('reason', { length: 500 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  eventTypeIdx: index('operational_events_type_idx').on(table.eventType),
  createdAtIdx: index('operational_events_created_at_idx').on(table.createdAt),
}));

export type OperationalEventRow = typeof operationalEvents.$inferSelect;
export type OperationalEventInsert = typeof operationalEvents.$inferInsert;

/**
 * Round Economics Config Snapshots Table
 * Stores the economics configuration active for each round
 * Milestone 9.6: Economics dashboard improvements
 */
export interface RoundEconomicsConfigData {
  // Top-10 cutoff threshold
  top10CutoffGuesses: number;

  // Pricing phase thresholds and prices
  pricing: {
    basePrice: string; // ETH
    priceRampStart: number; // guesses
    priceStepGuesses: number;
    priceStepIncrease: string; // ETH
    maxPrice: string; // ETH
  };

  // Pool split parameters
  poolSplit: {
    winnerPct: number;
    top10Pct: number;
    referrerPct: number;
    seedPct: number;
    creatorPct: number;
    // Fallback when no referrer
    fallbackTop10Pct: number;
    fallbackSeedPct: number;
  };
}

export const roundEconomicsConfig = pgTable('round_economics_config', {
  id: serial('id').primaryKey(),
  roundId: integer('round_id').notNull().references(() => rounds.id).unique(),
  config: jsonb('config').$type<RoundEconomicsConfigData>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  roundIdx: index('round_economics_config_round_idx').on(table.roundId),
}));

export type RoundEconomicsConfigRow = typeof roundEconomicsConfig.$inferSelect;
export type RoundEconomicsConfigInsert = typeof roundEconomicsConfig.$inferInsert;
