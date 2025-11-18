# Let's Have A Word 🎮

A global, persistent 5-letter word guessing game with ETH jackpots.

## Overview

**Let's Have A Word** is a Farcaster mini app where:
- **ONE** secret 5-letter word per round, shared globally
- Everyone in the world guesses the same word
- The word only changes when someone guesses it correctly
- First correct guesser wins an ETH jackpot

## Milestone 1.2 - Round Lifecycle ✅

This milestone implements the complete round lifecycle with pack-based purchases:

### Features Implemented

- ✅ **Database Schema**: PostgreSQL with Drizzle ORM
  - `game_rules` - Configurable rulesets
  - `users` - Player accounts (Farcaster integration pending)
  - `rounds` - Game rounds with commit-reveal proofs
  - `guesses` - Player guess history

- ✅ **Word Lists**
  - `ANSWER_WORDS` (~500 curated answer candidates)
  - `GUESS_WORDS` (~650 valid guessable words)
  - `SEED_WORDS` (~200 wheel pre-population words)
  - Automated constraint validation

- ✅ **Commit-Reveal Model**
  - Provably fair word selection
  - SHA-256 commit hash verification
  - Prevents backend cheating

- ✅ **Pack-Based Purchases**
  - Buy **3 guesses** for 0.0003 ETH per pack
  - Up to **3 packs per day** (9 total paid guesses)
  - Cleaner UX than individual purchases

- ✅ **Game Rules System**
  - JSONB configuration storage
  - Version-controlled rulesets
  - Functions: `getCurrentRules()`, `getRulesForRound()`

- ✅ **Round Lifecycle**
  - `createRound(opts?)` - Initialize new rounds with options
  - `getActiveRound()` - Get current unresolved round
  - `ensureActiveRound(opts?)` - Get or create active round
  - `getRoundById(id)` - Fetch specific round
  - `resolveRound(id, winner, referrer?)` - Mark winner
  - `verifyRoundCommitment(round)` - Verify fairness
  - Prevents creating multiple active rounds
  - Prevents resolving already-resolved rounds

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Crypto**: Node.js crypto module (SHA-256)

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env and set your DATABASE_URL
# DATABASE_URL=postgresql://user:password@localhost:5432/lets_have_a_word
```

### Database Setup

```bash
# Generate migrations
npm run db:generate

# Run migrations
npm run db:migrate

# Seed default game rules
npm run seed

# Validate setup
npm run validate
```

### Development

```bash
# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Open Drizzle Studio (database GUI)
npm run db:studio
```

## Usage Examples

### Creating and Managing Rounds

```typescript
import {
  createRound,
  getActiveRound,
  ensureActiveRound,
  resolveRound,
  verifyRoundCommitment,
} from './src/lib/rounds';

// Create a new round with random answer
const round = await createRound();

// Or specify an answer (for testing)
const testRound = await createRound({ forceAnswer: 'crane' });

// Or specify a custom ruleset
const customRound = await createRound({ rulesetId: 1 });

// Get the currently active round (or null if none)
const activeRound = await getActiveRound();

// Ensure an active round exists (create if needed)
const ensuredRound = await ensureActiveRound();

// Resolve a round with a winner
await resolveRound(round.id, winnerFid, referrerFid);

// Verify commitment integrity
const isValid = verifyRoundCommitment(round);
console.log('Commitment valid:', isValid);
```

### Getting Game Rules

```typescript
import { getCurrentRules, getRulesForRound } from './src/lib/game-rules';

// Get current active rules
const rules = await getCurrentRules();
console.log('Free guesses per day:', rules.config.freeGuessesPerDayBase);

// Get rules for specific round
const roundRules = await getRulesForRound(roundId);
```

### Word List Operations

```typescript
import {
  getAnswerWords,
  getGuessWords,
  isValidGuess,
  validateWordLists
} from './src/lib/word-lists';

// Validate constraints on startup
validateWordLists();

// Check if a word is valid
const valid = isValidGuess('crane'); // true

// Get all answer candidates
const answers = getAnswerWords();
```

## Game Mechanics (Overview)

### Guessing System
- **1 free guess/day** (base)
- **+3 guesses/day** (CLANKTON bonus: ≥100M tokens)
- **+1 guess/day** (share bonus: cast to Farcaster)
- **Up to 3 packs/day** - Buy 3 guesses per pack (0.0003 ETH per pack)
  - Total: **9 paid guesses/day max** (3 packs × 3 guesses)

### Economics
- **80%** of paid fees → prize pool
- **20%** of paid fees → next round seed (capped at 0.1 ETH)
- **Winner**: 80% of prize pool
- **Referrer**: 10% of prize pool
- **Top 10 guessers**: 10% of prize pool (split)

### Provable Fairness
Each round uses commit-reveal:
1. Backend chooses answer + random salt
2. Publishes `H(salt||answer)` before round starts
3. On resolution, reveals `salt` and `answer`
4. Anyone can verify: `H(salt||answer) === commit_hash`

## Project Structure

```
src/
├── __tests__/         # Unit tests (Vitest)
│   ├── word-lists.test.ts
│   ├── commit-reveal.test.ts
│   └── round-lifecycle.test.ts
├── data/              # Word list data files
│   ├── answer-words.ts
│   ├── guess-words.ts
│   └── seed-words.ts
├── db/                # Database schema and connection
│   ├── schema.ts
│   ├── index.ts
│   └── migrate.ts
├── lib/               # Core game logic
│   ├── word-lists.ts
│   ├── game-rules.ts
│   ├── commit-reveal.ts
│   └── rounds.ts
├── scripts/           # Utility scripts
│   ├── seed.ts
│   └── validate-setup.ts
├── types/             # TypeScript type definitions
│   └── index.ts
└── index.ts           # Main entry point
```

## What's NOT in Milestone 1.2

The following features are planned for future milestones:
- ❌ Farcaster integration (Neynar API) - **Milestone 1.3**
- ❌ Guess submission endpoints - **Milestone 1.3**
- ❌ Daily reset logic - **Milestone 1.3**
- ❌ CLANKTON balance checking - **Milestone 1.4**
- ❌ Share-to-earn callbacks - **Milestone 1.4**
- ❌ ETH jackpot processing - **Milestone 1.5**
- ❌ Referral tracking - **Milestone 1.5**
- ❌ Leaderboards - **Milestone 2.0**
- ❌ UI/Frontend - **Milestone 2.0**
- ❌ Announcer bot - **Milestone 2.1**

### What IS in Milestone 1.2
- ✅ Complete round lifecycle (create → active → resolve)
- ✅ Pack-based guess purchases (3 guesses per pack)
- ✅ Commit-reveal integrity checks
- ✅ Round state management
- ✅ Comprehensive test coverage

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Run in watch mode |
| `npm run db:generate` | Generate migrations |
| `npm run db:migrate` | Run migrations |
| `npm run db:studio` | Open database GUI |
| `npm run seed` | Seed default game rules |
| `npm run validate` | Validate setup |

## Database Schema

### `game_rules`
- Stores configurable game rulesets
- JSONB config for flexibility
- Versioned (v1, v2, etc.)

### `users`
- Farcaster ID (FID)
- Signer wallet address
- Optional referrer
- XP (placeholder)

### `rounds`
- Ruleset reference
- Answer + salt + commit hash
- Prize pool tracking
- Winner info
- Start/resolve timestamps

### `guesses`
- Round + user references
- Guessed word
- Paid/free flag
- Timestamp

## License

MIT License - see [LICENSE](LICENSE) file

## Contributing

This is Milestone 1.1 - the foundation. Future contributions will focus on:
- Farcaster integration (Milestone 1.2)
- Game mechanics (Milestone 1.3)
- ETH integration (Milestone 1.4)
- UI/UX (Milestone 2.x)

---

**Built with ❤️ by starl3xx**
