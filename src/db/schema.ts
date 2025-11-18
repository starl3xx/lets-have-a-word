import { pgTable, serial, varchar, integer, timestamp, boolean, jsonb, decimal, index } from 'drizzle-orm/pg-core';
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
  signerWalletAddress: varchar('signer_wallet_address', { length: 42 }), // Ethereum address
  referrerFid: integer('referrer_fid'), // FK to another user's FID
  xp: integer('xp').default(0).notNull(),
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
