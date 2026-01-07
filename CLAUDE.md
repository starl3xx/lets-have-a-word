# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Let's Have A Word is a massively multiplayer 5-letter word guessing game on Farcaster with ETH jackpots. All players worldwide hunt the same secret word, with incorrect guesses displayed on a spinning wheel. Winners receive proportional ETH payouts from a global prize pool.

## Commands

```bash
# Development
npm run dev                    # Start Next.js dev server
npm run build                  # Build for production
npm run test                   # Run Vitest tests

# Database
npm run db:generate            # Generate Drizzle migrations from schema
npm run db:migrate             # Apply migrations
npm run db:studio              # Open Drizzle Studio GUI

# Utilities
npm run validate               # Validate word lists, migrations, crypto setup
npm run seed                   # Seed database with default game rules
npm run simulate-round         # Simulate full round on Sepolia testnet
npm run create-round           # Manually create a new game round
npm run oracle:cron            # Update CLANKTON market cap oracle
```

## Architecture

**Tech Stack**: Next.js 14, PostgreSQL + Drizzle ORM, Wagmi, Base blockchain, Farcaster Mini App SDK, Upstash Redis

### Entry Points
- `/pages/index.tsx` - Main game page with GameContent component
- `/pages/splash.tsx` - OG Hunter prelaunch campaign (when `NEXT_PUBLIC_PRELAUNCH_MODE=1`)
- `/pages/admin/index.tsx` - Admin dashboard with Operations, Analytics, Archive, Economics tabs

### Core Library (`/src/lib/`)
- `guesses.ts` - Guess submission and validation
- `daily-limits.ts` - Free/paid guess allocation and consumption order
- `rounds.ts` - Round lifecycle management
- `jackpot-contract.ts` - Base smart contract interactions
- `economics.ts` - Prize pool calculations and payouts
- `encryption.ts` - AES-256-GCM answer encryption at rest
- `appErrors.ts` - 40+ unified error codes with user-facing messages

### API Structure (`/pages/api/`)
- **Game**: `/api/game.ts`, `/api/guess.ts`, `/api/wheel.ts`, `/api/round-state.ts`, `/api/user-state.ts`
- **Economy**: `/api/purchase-guess-pack.ts`, `/api/guess-pack-pricing.ts`, `/api/share-callback.ts`
- **Admin**: `/api/admin/operational/*` (kill switch, start/resolve rounds, contract diagnostics)
- **Cron**: `/api/cron/*` (health checks, oracle updates, archive sync, refund processing)

### Database Schema (`/src/db/schema.ts`)
Core tables: `users`, `rounds`, `guesses`, `daily_guess_state`, `round_payouts`, `pack_purchases`, `user_badges`, `game_rules`

## Key Patterns

### Game Economics
- **Prize Split**: 80% winner | 10% Top 10 | 10% referrer
- **Top 10 Lock**: Only guesses 1-850 count for rankings; later guesses win but don't rank (was 750 for rounds 1-3)
- **Guess Types**: Free (base) → CLANKTON bonus → Share bonus → Paid (consumed in order)
- **Daily Reset**: 11:00 UTC for free guesses

### Onchain Fairness
- **Commit-Reveal**: Answer committed to Base contract before guessing starts
- **Column Encryption**: Answers encrypted at rest with AES-256-GCM
- **Verification**: `/verify` page shows all onchain commitments and reveals

### Operational Safety
- **Kill Switch**: Cancels current round and triggers refunds
- **Dead Day Mode**: Finishes current round, prevents new ones
- **Sepolia Simulation**: Test full round lifecycle on testnet before mainnet

### Rate Limiting (Upstash Redis)
- Guesses: 8/10s burst + 30/60s sustained
- Purchases: 4/5min
- Fail-open if Redis unavailable

## Development Modes

```bash
NEXT_PUBLIC_TEST_MID_ROUND=true   # Pre-seeded round with mock data
NEXT_PUBLIC_LHAW_DEV_MODE=true    # No onchain calls, mock data, always shows tutorial
NEXT_PUBLIC_PRELAUNCH_MODE=1      # Routes all traffic to /splash
```

## Code Style

- **Apostrophes**: Use curly apostrophes (') not straight ones (') in UI text
- **No CLI scripts**: The user does not run anything via command line. Always create API endpoints (in `/pages/api/admin/operational/`) for admin tasks, data migrations, backfills, etc. Never suggest running npm scripts or CLI commands for operational tasks.

## Required Environment Variables

- `DATABASE_URL` - PostgreSQL connection
- `BASE_RPC_URL` - Base network RPC
- `NEYNAR_API_KEY` - Farcaster API access
- `OPERATOR_PRIVATE_KEY` - Contract transaction signing
- `ANSWER_ENCRYPTION_KEY` - 32-byte hex for AES-256-GCM
