# Let's Have A Word! 💬

**Massively multiplayer word hunt where everyone eliminates wrong answers until one player hits the ETH jackpot**

## Overview

**Let's Have A Word** is a Farcaster mini app where:
- **ONE** secret 5-letter word per round, shared globally
- Everyone in the world guesses the same word
- Wrong guesses appear on a spinning wheel for all to see
- The word only changes when someone guesses it correctly
- First correct guesser wins an ETH jackpot

## 🎯 Current Status: Milestone 4.1 Complete

All core game mechanics and onchain integration are fully implemented and production-ready:

### ✅ Milestone 4.1 - CLANKTON Integration (Latest)

Onchain token bonus system:

- **Real Balance Checking**
  - Queries CLANKTON balance on Base network
  - Uses ethers.js and Base RPC
  - Checks user's Farcaster signer wallet

- **Bonus System**
  - Holding ≥ 100M CLANKTON → +3 free guesses per day
  - Verified onchain at daily reset
  - Contract: `0x461DEb53515CaC6c923EeD9Eb7eD5Be80F4e0b07`

- **Configuration**
  - `BASE_RPC_URL` environment variable
  - Defaults to `https://mainnet.base.org`
  - Graceful error handling

### ✅ Milestone 3.2 - Top Ticker Polish

Live round status display with polished formatting:

- **Live Jackpot Display**
  - Shows current prize pool in ETH (from database)
  - Approximate USD equivalent with configurable rate
  - Proper formatting (trims trailing zeros, commas for USD)

- **Global Guess Counter**
  - Total guesses for current round
  - Formatted with thousand separators

- **Efficient Polling**
  - Updates every 15 seconds
  - Graceful error handling and loading states

- **Configuration**
  - `ETH_USD_RATE` environment variable support
  - Ready for oracle integration

### ✅ Milestone 3.1 - Jackpot + Split Logic

Complete economic system for prize distribution:

- **Per-Guess Economics (80/20 Split)**
  - 80% → Prize pool
  - 20% → Seed for next round (up to 0.1 ETH cap)
  - Overflow → Creator balance

- **Jackpot Resolution (80/10/10 Split)**
  - 80% → Winner
  - 10% → Referrer (or winner if no referrer)
  - 10% → Top 10 guessers (by volume, tiebreaker: earliest first guess)

- **Database Tables**
  - `system_state` - Creator balance tracking
  - `round_payouts` - Payout records per round

- **Tested & Verified**
  - Comprehensive test suite (8 tests passing)
  - Handles edge cases (zero jackpot, missing referrer, etc.)

### ✅ Milestone 2.3 - Wheel + Visual State + Top Ticker

Interactive UI with live game state:

- **Spinning Word Wheel**
  - Faux-3D carousel effect with distance-based scaling
  - Shows seed words + wrong guesses (alphabetically sorted)
  - Auto-scrolls to match user input
  - Pre-populated with 30 seed words per round

- **Top Ticker**
  - Live prize pool (ETH + USD)
  - Global guess count
  - Current round number
  - Polls `/api/round-state` every 15 seconds

- **Backend**
  - Seed word population system
  - Round status API endpoints
  - Wheel data retrieval

### ✅ Milestone 2.2 - Daily Limits & Bonus Mechanics

Complete daily guess allocation system:

- **Free Guesses**
  - 1 base free guess per day
  - +3 for CLANKTON holders (≥100M tokens)
  - +1 for sharing to Farcaster

- **Paid Guesses**
  - Buy packs of 3 guesses for 0.0003 ETH
  - Up to 3 packs per day (9 paid guesses max)
  - Economic effects automatically applied

- **State Management**
  - Per-user, per-day tracking
  - UTC-based daily reset
  - `daily_guess_state` table

### ✅ Milestone 2.1 - Farcaster Authentication

Full Farcaster integration with Neynar SDK:

- **Authentication**
  - Frame message verification
  - Signer UUID verification
  - Real FID extraction from Farcaster context

- **User Management**
  - Auto-upsert users from Farcaster data
  - Referral tracking
  - Spam score integration

- **Mobile Support**
  - Farcaster miniapp SDK integration
  - Auto-focus on mobile devices
  - Keyboard-optimized UX

### ✅ Milestone 1.4 - Minimal Frontend

Playable web interface:

- **Game UI**
  - 5-letter input with validation
  - Comprehensive feedback system
  - Loading states and error handling
  - Character counter and visual feedback

- **Mobile Optimizations**
  - Auto-focus input on mobile
  - Require GUESS button tap (no Enter key)
  - Responsive design

### ✅ Milestone 1.3 - Guess Logic

Core game mechanics:

- **Round Lifecycle**
  - Create → Active → Guess → Resolve
  - Commit-reveal for provable fairness
  - Automatic round resolution

- **Guess Validation**
  - Format checking (5 letters, A-Z)
  - Dictionary validation
  - Global wrong word deduplication
  - Race condition protection

- **Leaderboard**
  - Top 10 guesser ranking
  - By volume, tiebreaker by earliest guess

## Tech Stack

- **Frontend**: Next.js 14, React, Tailwind CSS
- **Backend**: TypeScript, Node.js
- **Database**: PostgreSQL (Neon)
- **ORM**: Drizzle ORM
- **Authentication**: Farcaster (Neynar SDK)
- **Crypto**: SHA-256 commit-reveal
- **Testing**: Vitest

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ (or Neon account)

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env and configure:
# - DATABASE_URL (PostgreSQL connection string)
# - NEYNAR_API_KEY (optional, for Farcaster auth)
# - ETH_USD_RATE (optional, defaults to 3000)
```

### Database Setup

```bash
# Run migrations
npm run db:migrate

# Seed default game rules
npm run seed

# Validate setup
npm run validate
```

### Development

```bash
# Start Next.js dev server (frontend + API)
npm run dev
# Opens at http://localhost:3000

# Build for production
npm run build

# Start production server
npm start

# Open Drizzle Studio (database GUI)
npm run db:studio

# Run tests
npm test
```

## API Endpoints

### Game API

- `POST /api/guess` - Submit a guess
  - Requires: `{ word, frameMessage?, signerUuid?, ref?, devFid? }`
  - Returns: Guess result (correct, incorrect, invalid, etc.)

- `GET /api/round-state` - Get current round status
  - Returns: `{ roundId, prizePoolEth, prizePoolUsd, globalGuessCount, lastUpdatedAt }`

- `GET /api/wheel` - Get wheel words
  - Returns: `{ roundId, words[] }` (seed words + wrong guesses)

## Database Schema

### Core Tables

**`game_rules`** - Configurable game rulesets
- JSONB config for flexibility
- Versioned rulesets

**`users`** - Player accounts
- Farcaster ID (FID)
- Signer wallet address
- Referrer tracking
- Spam score

**`rounds`** - Game rounds
- Answer + salt + commit hash (commit-reveal)
- Prize pool and seed tracking
- Winner and referrer info
- Timestamps

**`guesses`** - Player guesses
- Round and user references
- Guessed word
- Paid/free flag
- Correct/incorrect status

### Feature Tables

**`daily_guess_state`** - Daily limits (Milestone 2.2)
- Per-user, per-day tracking
- Free guess allocations
- Paid pack purchases
- Share bonus tracking

**`round_seed_words`** - Wheel seed words (Milestone 2.3)
- Cosmetic pre-population
- 30 random words per round

**`system_state`** - System-wide state (Milestone 3.1)
- Creator balance (accumulated from 20% fee overflow)

**`round_payouts`** - Payout records (Milestone 3.1)
- Winner, referrer, and top guesser payouts
- Amount in ETH
- Role tracking

## Game Mechanics

### Guessing System

**Free Guesses (per day)**
- 1 base free guess
- +3 for CLANKTON holders (≥100M tokens)
- +1 for sharing to Farcaster

**Paid Guesses (per day)**
- Buy packs of 3 guesses for 0.0003 ETH each
- Up to 3 packs per day (9 paid guesses max)

### Economics (Milestone 3.1)

**Per Paid Guess (80/20 Split)**
- 80% → Prize pool
- 20% → Seed for next round (capped at 0.1 ETH)
  - Overflow → Creator balance

**Jackpot Resolution (80/10/10 Split)**
- 80% → Winner
- 10% → Referrer (or winner if no referrer)
- 10% → Top 10 guessers (split equally)

**Top 10 Ranking**
- Ranked by total paid guess volume
- Tiebreaker: earliest first guess time

### Provable Fairness

Each round uses commit-reveal:
1. Backend chooses answer + random salt
2. Publishes `H(salt||answer)` before round starts
3. On resolution, reveals `salt` and `answer`
4. Anyone can verify: `H(salt||answer) === commit_hash`

### CLANKTON Bonus (Milestone 4.1)

Holding **≥ 100,000,000 CLANKTON** in your **signer wallet** grants **3 extra free guesses per day**.

- **Onchain Verification**: Balance checked using `balanceOf` on Base network
- **CLANKTON Contract**: `0x461DEb53515CaC6c923EeD9Eb7eD5Be80F4e0b07` (Base)
- **Signer Wallet Only**: v1 checks only the Farcaster signer wallet
- **Future**: Multi-wallet support planned for later milestone

**How it works:**
1. User connects with Farcaster (provides signer wallet)
2. Backend queries CLANKTON balance onchain
3. If balance ≥ 100M tokens → +3 free guesses per day
4. Bonus recalculated daily at UTC reset

**Configuration:**
- Set `BASE_RPC_URL` in `.env` for custom RPC endpoint
- Defaults to `https://mainnet.base.org`

## Project Structure

```
src/
├── lib/               # Core game logic
│   ├── word-lists.ts      # Word validation
│   ├── game-rules.ts      # Rule management
│   ├── commit-reveal.ts   # Provable fairness
│   ├── rounds.ts          # Round lifecycle
│   ├── guesses.ts         # Guess submission
│   ├── users.ts           # User management
│   ├── farcaster.ts       # Farcaster auth
│   ├── daily-limits.ts    # Daily guess limits
│   ├── wheel.ts           # Wheel + ticker data
│   ├── economics.ts       # Jackpot + payouts
│   └── clankton.ts        # CLANKTON bonus checking
├── db/                # Database
│   ├── schema.ts          # Drizzle schema
│   ├── index.ts           # DB connection
│   └── migrate.ts         # Migration runner
├── data/              # Word lists
│   ├── answer-words.ts
│   ├── guess-words.ts
│   └── seed-words.ts
├── types/             # TypeScript types
│   └── index.ts
└── scripts/           # Utilities
    ├── seed.ts
    └── validate-setup.ts

pages/
├── api/               # Next.js API routes
│   ├── guess.ts           # Guess submission
│   ├── round-state.ts     # Round status
│   └── wheel.ts           # Wheel data
├── _app.tsx           # App wrapper (Farcaster SDK init)
└── index.tsx          # Main game UI

components/
├── Wheel.tsx          # Spinning word wheel
└── TopTicker.tsx      # Live status ticker

drizzle/               # Database migrations
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm test` | Run tests |
| `npm run db:generate` | Generate migrations |
| `npm run db:migrate` | Run migrations |
| `npm run db:studio` | Open database GUI |
| `npm run seed` | Seed default game rules |
| `npm run validate` | Validate setup |

## Usage Examples

### Submitting Guesses

```typescript
import { submitGuessWithDailyLimits } from './src/lib/daily-limits';

// Submit guess with daily limits enforcement
const result = await submitGuessWithDailyLimits({
  fid: 12345,
  word: 'CRANE',
});

// Handle result
if (result.status === 'correct') {
  console.log('Winner!');
} else if (result.status === 'no_guesses_left_today') {
  console.log('Out of guesses - buy a pack!');
}
```

### Getting Round Status

```typescript
import { getActiveRoundStatus } from './src/lib/wheel';

const status = await getActiveRoundStatus();
console.log(`Prize pool: ${status.prizePoolEth} ETH`);
console.log(`USD value: $${status.prizePoolUsd}`);
console.log(`Total guesses: ${status.globalGuessCount}`);
```

### Managing Rounds

```typescript
import { createRound, resolveRound } from './src/lib/rounds';
import { resolveRoundAndCreatePayouts } from './src/lib/economics';

// Create new round
const round = await createRound();

// Resolve with winner (creates payouts automatically)
await resolveRound(roundId, winnerFid, referrerFid);
// Payouts are created in round_payouts table
```

## What's Next?

Planned future milestones:
- **Milestone 4.2**: Share-to-earn callbacks (Farcaster webhook)
- **Milestone 5.1**: Announcer bot (automated round announcements)
- **Milestone 5.2**: ETH payment processing (actual payments)
- **Milestone 5.3**: Performance optimizations (caching, indexes)
- **Milestone 5.4**: Round archive (historical data browsing)

## Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test economics.test.ts

# Run with coverage
npm test -- --coverage
```

Current test coverage:
- ✅ Word list validation
- ✅ Commit-reveal integrity
- ✅ Round lifecycle
- ✅ Guess submission
- ✅ Economic functions (Milestone 3.1)

## License

MIT License - see [LICENSE](LICENSE) file

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

---

**Built with ❤️ by starl3xx**
