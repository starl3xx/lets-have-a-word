# Let's Have A Word - Complete Game Documentation

## Table of Contents
1. [Game Overview](#game-overview)
2. [Game Mechanics](#game-mechanics)
3. [Technical Architecture](#technical-architecture)
4. [Frontend Structure](#frontend-structure)
5. [Backend API](#backend-api)
6. [Database Schema](#database-schema)
7. [Dev Mode](#dev-mode)
8. [UI/UX Patterns](#uiux-patterns)
9. [Word Lists & Validation](#word-lists--validation)
10. [Farcaster Integration](#farcaster-integration)
11. [Key Features by Milestone](#key-features-by-milestone)

---

## Game Overview

**Let's Have A Word** is a social word-guessing game built on Farcaster where players compete to guess a secret 5-letter word. Every wrong guess helps narrow the field, and one correct guess wins the ETH jackpot.

### Core Concept
- **Secret Word**: Each round has a hidden 5-letter word
- **Collaborative Elimination**: Wrong guesses are shared publicly, helping everyone
- **Single Winner**: First person to guess correctly wins the entire prize pool
- **Commit-Reveal**: Answer is stored as a cryptographic hash to prevent cheating

### Key Differentiators
- **Social Deduction**: Wrong guesses benefit everyone
- **Real ETH Stakes**: Prize pool grows with paid guesses
- **Referral System**: Earn 10% of your referrals' winnings
- **CLANKTON Bonus**: Token holders get +3 daily guesses

---

## Game Mechanics

### Daily Guess Allocation
Each player gets a daily allocation of guesses:
- **Base Free Guesses**: 1 per day
- **CLANKTON Bonus**: +3 if holding 100M+ CLANKTON tokens
- **Share Bonus**: +1 for sharing to Farcaster (once per day)
- **Paid Guess Packs**: Buy 3 guesses for 0.0003 ETH (max 3 packs/day)

**Total Possible Daily Guesses**: 13 (1 base + 3 CLANKTON + 1 share + 9 paid)

### Prize Pool Economics
- **70% to Prize Pool**: Accumulates for the winner
- **20% to Next Round Seed**: Ensures minimum prize
- **10% to Creator**: Platform fee

**Jackpot Distribution** (when won):
- **80%**: Winner
- **10%**: Winner's referrer (if they have one)
- **10%**: Top 10 guessers that round (split equally)

### Round Lifecycle
1. **Round Creation**: New round starts with commit hash of answer
2. **Guessing Phase**: Players submit guesses (valid 5-letter words only)
3. **Wrong Guesses**: Added to public wheel, visible to all players
4. **Correct Guess**: Round ends, winner determined, payouts processed
5. **Resolution**: Answer revealed, new round starts with seed from previous

### Word Validation
- Must be exactly **5 letters**
- Must be in the **GUESS_WORDS** dictionary (10,516 words)
- Answer must be in **ANSWER_WORDS** subset (2,279 common words)
- Cannot guess the same word twice in a round
- Case-insensitive (BRAIN = brain = BrAiN)
- All words normalized to UPPERCASE internally

---

## Technical Architecture

### Tech Stack
- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes, Serverless Functions
- **Database**: PostgreSQL with Drizzle ORM
- **Blockchain**: Base (Ethereum L2)
- **Social**: Farcaster Frame SDK

### Project Structure
```
lets-have-a-word/
├── pages/
│   ├── index.tsx                    # Main game page
│   ├── archive/
│   │   ├── index.tsx                # Archive list page (5.4)
│   │   └── [roundNumber].tsx        # Archive detail page (5.4)
│   ├── admin/
│   │   ├── analytics.tsx            # Admin dashboard (5.2/5.3)
│   │   └── archive.tsx              # Admin archive management (5.4)
│   └── api/
│       ├── game.ts                  # Unified game state (dev mode)
│       ├── guess.ts                 # Submit guess (with user quality check)
│       ├── wheel.ts                 # Get wheel words
│       ├── round-state.ts           # Get round status (with live ETH/USD)
│       ├── user-state.ts            # Get user state
│       ├── share-callback.ts        # Handle share bonus (logs SHARE_SUCCESS)
│       ├── archive/                 # Archive endpoints (5.4)
│       │   ├── latest.ts            # Get latest archived round
│       │   ├── list.ts              # List archived rounds (paginated)
│       │   └── [roundNumber].ts     # Get specific round detail
│       ├── user/
│       │   ├── stats.ts             # User statistics
│       │   └── referrals.ts         # Referral data
│       └── admin/
│           ├── me.ts                # Admin status check
│           ├── archive/             # Admin archive endpoints (5.4)
│           │   ├── sync.ts          # Sync/archive rounds
│           │   ├── errors.ts        # View archive errors
│           │   └── debug/
│           │       └── [roundNumber].ts  # Debug info for round
│           └── analytics/           # Analytics endpoints
│               ├── dau.ts           # Daily active users
│               ├── wau.ts           # Weekly active users
│               ├── events.ts        # Raw events (paginated)
│               ├── free-paid.ts     # Free/paid ratio
│               ├── jackpot.ts       # Jackpot growth
│               ├── referral.ts      # Referral funnel
│               ├── fairness.ts      # Fairness audits (5.3)
│               ├── simulations.ts   # Run simulations (5.3)
│               ├── performance.ts   # CLANKTON advantage (5.3)
│               └── export.ts        # Data export (5.3)
├── components/
│   ├── Wheel.tsx                    # 3D word wheel
│   ├── LetterBoxes.tsx              # 5-letter input boxes
│   ├── GameKeyboard.tsx             # Custom QWERTY keyboard
│   ├── UserState.tsx                # Guess counts display
│   ├── TopTicker.tsx                # Prize pool ticker (ETH + USD)
│   ├── SharePromptModal.tsx         # Share bonus prompt
│   ├── FirstTimeOverlay.tsx         # Onboarding
│   ├── StatsSheet.tsx               # User statistics
│   ├── ReferralSheet.tsx            # Referral system
│   └── FAQSheet.tsx                 # Help/FAQ
├── src/
│   ├── lib/
│   │   ├── rounds.ts                # Round management
│   │   ├── guesses.ts               # Guess submission
│   │   ├── daily-limits.ts          # Daily guess tracking (logs GUESS_PACK_USED)
│   │   ├── wheel.ts                 # Wheel data logic
│   │   ├── word-lists.ts            # Word validation
│   │   ├── prices.ts                # ETH/USD price fetching (CoinGecko)
│   │   ├── input-state.ts           # Input state machine
│   │   ├── commit-reveal.ts         # Cryptographic hashing
│   │   ├── clankton.ts              # Token balance checking
│   │   ├── economics.ts             # Prize pool calculations
│   │   ├── analytics.ts             # Analytics event logging (5.2)
│   │   ├── announcer.ts             # Farcaster announcer bot (5.1)
│   │   ├── user-quality.ts          # User quality gating (5.3)
│   │   ├── archive.ts               # Round archive logic (5.4)
│   │   ├── devGameState.ts          # Dev mode helpers
│   │   └── devMidRound.ts           # Dev test scenarios
│   ├── services/                    # Service modules (Milestone 5.3)
│   │   ├── fairness-monitor/
│   │   │   ├── index.ts             # Fairness validation & audit
│   │   │   └── prize-audit.ts       # Prize pool verification
│   │   └── simulation-engine/
│   │       └── index.ts             # Adversarial simulations
│   ├── data/
│   │   ├── answer_words.ts          # 2,279 canonical answer words (UPPERCASE)
│   │   ├── guess_words.ts           # 10,516 canonical valid guesses (UPPERCASE)
│   │   ├── seed-words.ts            # Deprecated (no longer used)
│   │   └── test-word-lists.ts       # Dev mode word lists
│   ├── db/
│   │   ├── schema.ts                # Database schema
│   │   └── index.ts                 # Database client
│   └── types/
│       └── index.ts                 # TypeScript types
├── docs/
│   └── MILESTONE_5_3_DOCUMENTATION.md  # Detailed 5.3 docs
└── .env.example                     # Environment variables
```

### Key Dependencies
- `next`: 14.2.33
- `react`: 18.3.1
- `drizzle-orm`: Database ORM
- `@farcaster/miniapp-sdk`: Farcaster integration
- `wagmi`: Wallet connection
- `viem`: Ethereum utilities

---

## Frontend Structure

### Main Game Page (`pages/index.tsx`)

**State Management:**
```typescript
// Input state
const [letters, setLetters] = useState<string[]>(['', '', '', '', '']);

// Farcaster context
const [fid, setFid] = useState<number | null>(null);

// Wheel state
const [wheelWords, setWheelWords] = useState<string[]>([]);

// Dev mode tracking
const [devWrongGuesses, setDevWrongGuesses] = useState<Set<string>>(new Set());

// UI state
const [showShareModal, setShowShareModal] = useState(false);
const [showFirstTimeOverlay, setShowFirstTimeOverlay] = useState(false);
```

**Key Flows:**
1. **Typing**: Updates `letters` array, validates in real-time
2. **Submission**: Calls `/api/guess`, updates wheel, shows result
3. **Share Prompt**: Delays 2 seconds, then shows modal
4. **State Refresh**: Updates user state after each guess

### Input State Machine (`src/lib/input-state.ts`)

**8 Possible States:**
```typescript
type InputState =
  | 'IDLE_EMPTY'                           // No input
  | 'TYPING_PARTIAL'                       // 1-4 letters
  | 'TYPING_FULL_VALID'                    // 5 letters, valid word
  | 'TYPING_FULL_INVALID_NONSENSE'         // 5 letters, not in dictionary
  | 'TYPING_FULL_INVALID_ALREADY_GUESSED'  // 5 letters, already guessed
  | 'SUBMITTING'                           // Sending to server
  | 'RESULT_CORRECT'                       // Correct guess
  | 'RESULT_WRONG_VALID'                   // Valid but incorrect
  | 'OUT_OF_GUESSES';                      // No guesses remaining
```

**Frontend-Owned States:**
- `IDLE_EMPTY`, `TYPING_PARTIAL`, `TYPING_FULL_VALID`, `TYPING_FULL_INVALID_*`
- Computed locally based on input and wheel words

**Backend-Owned States:**
- `SUBMITTING`, `RESULT_CORRECT`, `RESULT_WRONG_VALID`, `OUT_OF_GUESSES`
- Determined by server response

### Wheel Component (`components/Wheel.tsx`)

**Features (Milestone 4.11 - Virtualized):**
- **Alphabetical Display**: All 10,516 words sorted A-Z
- **Virtual Scrolling**: Renders only ~100 visible words (99.5% DOM reduction)
- **Fast Rotation**: 150ms animated scroll with visible rotation effect
- **Auto-Scrolling**: Jumps to alphabetical position as you type
- **3D Effect**: Scale/opacity/color based on distance from center
- **Dynamic Gap**: 10vh gap where input boxes appear
- **Status-Based Colors**: Unguessed (gray), wrong (red), winner (gold)
- **Binary Search**: O(log n) alphabetical positioning (750x faster)

**Performance:**
- Renders ~100 words instead of 10,516 (99.5% reduction)
- 60 FPS smooth scrolling
- Instant response to keyboard input
- Custom requestAnimationFrame animation

**How It Works:**
```typescript
// Binary search for alphabetical position (O(log n))
const normalizedGuess = currentGuess.toLowerCase();
let left = 0, right = words.length - 1;
while (left <= right) {
  const mid = Math.floor((left + right) / 2);
  if (words[mid].word.toLowerCase() >= normalizedGuess) {
    result = mid;
    right = mid - 1;
  } else {
    left = mid + 1;
  }
}

// Custom 150ms scroll animation for visible rotation
const animateScrollTo = (targetScrollTop) => {
  const duration = 150; // Fast but visible
  const easeOutCubic = 1 - Math.pow(1 - progress, 3);
  containerRef.current.scrollTop = start + distance * easeOutCubic;
};

// Dynamic 10vh gap
const GAP_HEIGHT = Math.round(window.innerHeight * 0.10);
```

### Letter Boxes Component (`components/LetterBoxes.tsx`)

**Features:**
- 5 individual input boxes
- State-based border colors (blue=valid, red=invalid, green=correct)
- Shake animation on invalid input
- Auto-focus management
- Hardware keyboard support

**Border Color Logic:**
```typescript
TYPING_FULL_VALID          → Blue (#2563eb)
TYPING_FULL_INVALID_*      → Red (#ef4444)
RESULT_CORRECT             → Green (#22c55e)
RESULT_WRONG_VALID         → Red (#ef4444)
OUT_OF_GUESSES             → Gray (#9ca3af)
```

---

## Backend API

### Core Endpoints

#### `POST /api/guess`
Submit a guess for the current round.

**Request:**
```json
{
  "word": "BRAIN",
  "devFid": 12345  // Dev mode only
}
```

**Response Types:**
```typescript
| { status: 'correct', word: string, roundId: number, winnerFid: number }
| { status: 'incorrect', word: string, totalGuessesForUserThisRound: number }
| { status: 'already_guessed_word', word: string }
| { status: 'invalid_word', reason: 'not_5_letters' | 'non_alpha' | 'not_in_dictionary' }
| { status: 'round_closed' }
| { status: 'no_guesses_left_today' }
```

**Dev Mode Behavior:**
- Checks `LHAW_DEV_MODE=true` environment variable
- Compares against fixed solution (`LHAW_DEV_FIXED_SOLUTION`)
- No database writes
- Instant response

#### `GET /api/wheel`
Get all words for the wheel display.

**Response:**
```json
{
  "roundId": 123,
  "words": ["about", "brain", "build", "clues", ...]
}
```

**Words Include:**
- Seed words (cosmetic pre-population)
- Real wrong guesses from players
- Sorted alphabetically

**Dev Mode:**
- Returns synthetic seed words
- Tracks wrong guesses on frontend
- No database access

#### `GET /api/user-state`
Get user's daily guess allocations.

**Query Params:**
- `devFid`: User FID (dev mode)
- `walletAddress`: Connected wallet (for CLANKTON check)

**Response:**
```json
{
  "fid": 12345,
  "freeGuessesRemaining": 5,
  "paidGuessesRemaining": 3,
  "totalGuessesRemaining": 8,
  "clanktonBonusActive": true,
  "freeAllocations": {
    "base": 3,
    "clankton": 3,
    "shareBonus": 1
  },
  "paidPacksPurchased": 1,
  "maxPaidPacksPerDay": 3,
  "canBuyMorePacks": true
}
```

#### `GET /api/round-state`
Get current round status for top ticker with live ETH/USD conversion.

**Features (Milestone 4.12):**
- Live ETH/USD price from CoinGecko API
- 60-second caching to avoid rate limits
- Graceful fallback if API unavailable
- Works in dev mode and production

**Response:**
```json
{
  "roundId": 123,
  "prizePoolEth": "0.5",
  "prizePoolUsd": "1685.50",  // Live from CoinGecko
  "globalGuessCount": 42,
  "lastUpdatedAt": "2025-01-15T12:00:00Z"
}
```

#### `POST /api/share-callback`
Award share bonus after user shares to Farcaster.

**Request:**
```json
{
  "fid": 12345,
  "castHash": "0x..."
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Share bonus awarded!"
}
```

#### `GET /api/game` (Dev Mode Only)
Unified game state endpoint for previewing all states.

**Query Params:**
- `devState`: Backend state to preview (`RESULT_CORRECT`, `RESULT_WRONG_VALID`, etc.)
- `devInput`: Input word for preview
- `devFid`: User FID

**Response:**
```json
{
  "roundId": 999999,
  "prizePoolEth": "0.42",
  "globalGuessCount": 73,
  "userState": { ... },
  "wheelWords": ["brain", "build", ...],
  "devMode": true,
  "devSolution": "crane",
  "devState": "RESULT_CORRECT",
  "devInput": "CRANE"
}
```

---

## Database Schema

### Tables

#### `game_rules`
Game configuration and economics.
```sql
CREATE TABLE game_rules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  config JSONB NOT NULL,  -- GameRulesConfig
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### `users`
Player profiles.
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  fid INTEGER UNIQUE NOT NULL,
  username TEXT,
  signer_wallet_address TEXT,
  custody_address TEXT,
  spam_score INTEGER DEFAULT 0,
  referrer_fid INTEGER REFERENCES users(fid),
  xp INTEGER DEFAULT 0,
  -- Milestone 5.3: User Quality Gating
  user_score DECIMAL(5, 3),              -- Neynar user quality score (0.000-1.000)
  user_score_updated_at TIMESTAMP,        -- Cache timestamp for score refresh
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Milestone 5.3: Index for efficient cache expiration queries
CREATE INDEX users_user_score_updated_at_idx ON users(user_score_updated_at);
```

#### `rounds`
Game rounds with commit-reveal.
```sql
CREATE TABLE rounds (
  id SERIAL PRIMARY KEY,
  ruleset_id INTEGER REFERENCES game_rules(id),
  answer TEXT NOT NULL,
  salt TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  prize_pool_eth NUMERIC(18,18) DEFAULT 0,
  seed_next_round_eth NUMERIC(18,18) DEFAULT 0,
  winner_fid INTEGER REFERENCES users(fid),
  referrer_fid INTEGER REFERENCES users(fid),
  started_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  is_dev_test_round BOOLEAN DEFAULT FALSE
);
```

#### `guesses`
All player guesses.
```sql
CREATE TABLE guesses (
  id SERIAL PRIMARY KEY,
  round_id INTEGER REFERENCES rounds(id),
  fid INTEGER REFERENCES users(fid),
  word TEXT NOT NULL,
  is_paid BOOLEAN DEFAULT FALSE,
  is_correct BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `daily_guess_state`
Per-user, per-day guess tracking.
```sql
CREATE TABLE daily_guess_state (
  id SERIAL PRIMARY KEY,
  fid INTEGER REFERENCES users(fid),
  date DATE NOT NULL,
  free_allocated_base INTEGER DEFAULT 0,
  free_allocated_clankton INTEGER DEFAULT 0,
  free_allocated_share_bonus INTEGER DEFAULT 0,
  free_spent INTEGER DEFAULT 0,
  paid_packs_purchased INTEGER DEFAULT 0,
  paid_guess_credits INTEGER DEFAULT 0,
  paid_spent INTEGER DEFAULT 0,
  UNIQUE(fid, date)
);
```

#### `round_seed_words`
Cosmetic words to populate wheel.
```sql
CREATE TABLE round_seed_words (
  id SERIAL PRIMARY KEY,
  round_id INTEGER REFERENCES rounds(id),
  word TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `round_payouts`
Payout tracking for winners, referrers, top 10.
```sql
CREATE TABLE round_payouts (
  id SERIAL PRIMARY KEY,
  round_id INTEGER REFERENCES rounds(id),
  fid INTEGER REFERENCES users(fid),
  payout_type TEXT NOT NULL,  -- 'winner' | 'referrer' | 'top10'
  amount_eth NUMERIC(18,18) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Dev Mode

### Overview
Dev mode allows testing and previewing all game states without database access or onchain operations.

### Environment Variables
```bash
# Master switch - enables all dev mode features
LHAW_DEV_MODE=true

# Fixed solution word for testing
LHAW_DEV_FIXED_SOLUTION=CRANE

# Default dev user FID
LHAW_DEV_USER_ID=12345

# Enable forced-state preview mode
LHAW_DEV_FORCE_STATE_ENABLED=true
```

### Two Dev Modes

#### 1. Interactive Dev Mode
Normal gameplay with no database:
- Type words, submit guesses
- Compares against `LHAW_DEV_FIXED_SOLUTION`
- Wrong guesses tracked on frontend
- Instant feedback, no API delays
- Unlimited resets

**How to Use:**
```
Set LHAW_DEV_MODE=true
Navigate to https://your-app.com/
Play normally - type CRANE to win!
```

#### 2. Forced-State Preview Mode
Snapshot mode for QC/screenshots:
- Use `devState` URL param to load specific state
- Use `devInput` to set current input
- Bypasses normal game flow
- Perfect for design testing

**How to Use:**
```
Set LHAW_DEV_FORCE_STATE_ENABLED=true

Preview correct guess:
/?devState=RESULT_CORRECT&devInput=CRANE

Preview wrong guess:
/?devState=RESULT_WRONG_VALID&devInput=BRAIN

Preview out of guesses:
/?devState=OUT_OF_GUESSES
```

### Dev Mode Behavior

**All API Endpoints:**
- Check `isDevModeEnabled()` first
- Return synthetic data immediately
- No database queries
- No onchain calls

**Frontend:**
- Tracks wrong guesses in `devWrongGuesses` Set
- Merges with base wheel words
- Maintains alphabetical sorting
- Normal typing/input behavior

**Backend:**
- Validates words normally
- Compares to fixed solution
- Returns synthetic results
- Logs with 🎮 emoji for visibility

### Dev Mode Word Lists
Located in `/src/data/test-word-lists.ts`:
- ~250 ANSWER_WORDS
- ~80 SEED_WORDS
- ~600 extra GUESS_WORDS
- All lowercase, 5 letters
- No overlap between answer/seed

---

## UI/UX Patterns

### Color System
```css
/* Primary Colors */
--blue-primary: #2D68C7;      /* Guess button */
--farcaster-purple: #6A3CFF;  /* Share buttons */
--green-success: #22c55e;     /* Correct guess */
--red-error: #ef4444;         /* Wrong guess */

/* State Colors */
--border-valid: #2563eb;      /* Valid 5-letter word */
--border-invalid: #ef4444;    /* Invalid word */
--border-correct: #22c55e;    /* Correct answer */
--border-neutral: #d1d5db;    /* Empty/partial */
```

### Typography
- **Font**: Rubik (300, 400, 500, 600, 700, 800, 900)
- **Input Boxes**: 2rem, bold, uppercase
- **Wheel Words**: 1.3rem, uppercase, variable letter-spacing
- **UI Text**: 0.875rem - 1rem

### Spacing & Layout
- **Max Width**: 28rem (448px) for game container
- **Input Boxes**: 4rem × 4rem with 0.5rem gap
- **Keyboard**: Full-width, fixed bottom
- **Wheel**: Fills vertical space between header and keyboard

### Animations
```typescript
// Shake animation on invalid input
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-10px); }
  75% { transform: translateX(10px); }
}

// Wheel 3D effect
transform: scale(${scale});
opacity: ${opacity};
transition: all 300ms ease-out;
```

### Haptics
```typescript
// Key press
haptics.keyTap()          // Light tap

// Submission
haptics.guessSubmitting() // Medium impact

// State transitions
haptics.invalidWord()     // Error vibration
haptics.correctGuess()    // Success pattern
haptics.wrongGuess()      // Subtle feedback
```

### Modal/Sheet Patterns
- **Modal**: Center overlay with backdrop (SharePromptModal, FirstTimeOverlay)
- **Sheet**: Bottom slide-up (StatsSheet, ReferralSheet, FAQSheet)
- **Backdrop**: `bg-black bg-opacity-50` with click-to-close
- **Animation**: Smooth transitions, respects user motion preferences

### Responsive Design
- **Mobile-First**: Optimized for 375px - 428px
- **Safe Areas**: Respects `env(safe-area-inset-bottom)` for notched devices
- **Keyboard Offset**: Adjusts layout when keyboard visible
- **Touch Targets**: Minimum 44px × 44px for all interactive elements

---

## Word Lists & Validation

### Canonical Word Lists (Milestone 4.11)

#### ANSWER_WORDS (2,279 words)
Common 5-letter words suitable as answers.
- **File**: `/src/data/answer_words.ts`
- **Format**: UPPERCASE array
- **Examples**: `'ABOUT', 'BRAIN', 'CRANE', 'DREAM'`
- **Constraint**: Strict subset of GUESS_WORDS
- **Invariant**: ANSWER_WORDS ⊆ GUESS_WORDS

#### GUESS_WORDS (10,516 words)
All valid guessable words - the complete dictionary.
- **File**: `/src/data/guess_words.ts`
- **Format**: UPPERCASE array
- **Examples**: All answer words + obscure words
- **Constraint**: Must contain all ANSWER_WORDS
- **Usage**: Displayed on wheel from game start, validation dictionary

#### SEED_WORDS (Deprecated - Milestone 4.11)
**No longer used in game logic.**
- Previously used for cosmetic wheel population
- Replaced by showing all GUESS_WORDS from start
- `populateRoundSeedWords()` is now a no-op for backwards compatibility
- Wheel displays all 10,516 GUESS_WORDS using virtualization

### Validation Flow (Milestone 4.11)
```typescript
// 1. Length check
if (word.length !== 5) return false;

// 2. Character check
if (!/^[a-zA-Z]+$/.test(word)) return false;

// 3. Dictionary check (UPPERCASE normalization)
const normalized = word.toUpperCase().trim();
if (!GUESS_WORDS.includes(normalized)) return false;

// 4. Already guessed check
if (wheelWords.includes(normalized)) return false;

// ✓ Valid!
```

### Case Handling (Milestone 4.11)
- **User Input**: Converted to UPPERCASE for display (`BRAIN`)
- **Storage**: Stored as UPPERCASE (`BRAIN`)
- **Validation**: UPPERCASE comparison (`word.toUpperCase()`)
- **Wheel Display**: UPPERCASE (`BRAIN`)
- **Alphabetical Sorting**: Lowercase comparison for sorting (`word.toLowerCase()`)

---

## Farcaster Integration

### SDK Setup
```typescript
import sdk from '@farcaster/miniapp-sdk';

// Get user context
const context = await sdk.context;
const fid = context?.user?.fid;
```

### Authentication Flow
1. App loads in Farcaster frame
2. SDK provides user context
3. Extract FID from context
4. Use FID for all API calls
5. Fallback to `devFid` in development

### Composer Integration
```typescript
// Share to Farcaster
await sdk.actions.composeCast({
  text: `My guess "${word}" in Let's Have A Word!...`
});

// Open URL (alternate method)
await sdk.actions.openUrl({
  url: `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}`
});
```

### Share Bonus Flow
1. User submits guess (correct or incorrect)
2. Wait 2 seconds (user reads feedback)
3. Show SharePromptModal
4. User clicks "Share to Farcaster"
5. Open Farcaster composer with pre-filled text
6. After 2-second delay, call `/api/share-callback`
7. Award +1 guess if not already claimed today
8. Update UserState display

---

## Key Features by Milestone

### Completed Milestones (1.1 - 5.4)

### Milestone 1.1: Data Model + Rules
- Database schema design (game_rules, users, rounds, guesses)
- JSON ruleset configuration system
- Word list imports (ANSWER_WORDS, GUESS_WORDS, SEED_WORDS)
- Ruleset management (getRulesForRound)
- Foreign key relationships

### Milestone 1.2: Round Lifecycle
- Round creation with commit-reveal
- Salt generation and SHA-256 hashing
- Random answer selection from ANSWER_WORDS
- Prize pool initialization
- Round resolution logic
- Winner and referrer settlement

### Milestone 1.3: Guess Logic Basic
- Per-FID guess counters
- Global wrong word deduplication
- Top 10 guesser ranking logic
- Max paid guesses per day (10)
- Guess validation and submission

### Milestone 1.4: Minimal Frontend
- Basic 5-letter input UI
- Simple guess submission flow
- POST /guess endpoint integration
- Correct/wrong feedback display
- No wheel, no Farcaster yet (barebones test UI)

### Milestone 2.1: Farcaster Authentication
- Integrated Farcaster MiniApp SDK
- User context extraction (FID)
- Dev mode fallback for testing

### Milestone 2.2: Daily Limits
- Base 1 free guess per day
- Paid guess packs (3 for 0.0003 ETH)
- Database tracking per user per day

### Milestone 2.3: Wheel + Top Ticker
- 3D wheel component with wrong guesses
- Alphabetical sorting
- Prize pool display
- Auto-scrolling to typed word position

### Milestone 3.1: Jackpot + Split Logic
- 80/20 split on paid guesses (prize pool / seed)
- 80/10/10 jackpot distribution (winner / referrer / top 10)
- Top 10 payout distribution logic
- Creator balance tracking
- round_payouts table for payout records
- 0.03 ETH seed cap logic
- Comprehensive economic functions

### Milestone 3.2: Top Ticker Polish
- Real prize pool from database
- USD conversion with live CoinGecko API (updated in Milestone 4.12)
- Proper number formatting (always 2 decimal places)
- Live updates every 15 seconds

### Milestone 4.1: User State Display
- Guess counts (free/paid/total)
- CLANKTON bonus indicator
- Real-time updates after each guess

### Milestone 4.2: Share Bonus
- Share prompt modal after guesses
- +1 free guess for sharing
- Once per day limit
- Farcaster composer integration

### Milestone 4.3: UX Polish
- First-time overlay for onboarding
- Stats sheet with user metrics
- Referral sheet with tracking
- FAQ sheet
- Navigation buttons

### Milestone 4.4: Hardware Keyboard Support
- A-Z letter input
- Backspace handling
- Enter to submit
- Focus management

### Milestone 4.5: Dev Mid-Round Test Mode
- Pre-populated dev rounds
- Test data generation
- 50-100 fake guesses
- Simulated prize pool

### Milestone 4.6: Input States & Visual Behavior
- 8-state input machine
- State-based border colors
- Error messages
- Shake animations
- Ghost word preview

### Milestone 4.7: Haptic Feedback
- Key press haptics
- State transition haptics
- Submission feedback
- Error vibrations

### Milestone 4.8: Dev Mode Backend
- Interactive dev gameplay
- Forced-state preview mode
- No database dependency
- Synthetic data for all endpoints
- URL param-based previews
- Fixed solution testing

### Milestone 4.9: Non-Referral Prize Flow
- Prize distribution to seed pool
- Creator fee allocation
- Payout tracking for non-referred winners

### Milestone 4.10: Global Word Wheel
- Display all guessable words from start
- Status-based word rendering
- Real layout gap for input boxes

### Milestone 4.11: Final Word List Integration & Virtualization
- **Canonical Word Lists**: ANSWER_WORDS (2,279), GUESS_WORDS (10,516)
- **UPPERCASE Normalization**: All words stored and validated in UPPERCASE
- **Deprecated SEED_WORDS**: No longer used in game logic
- **Virtual Scrolling**: Renders ~100 visible words (99.5% DOM reduction)
- **Binary Search**: O(log n) alphabetical positioning (750x faster)
- **Performance**: 60 FPS with 10,516 words
- **Fast Rotation**: 150ms animated scroll with visible wheel rotation
- **Dynamic Gap**: 10vh responsive gap height
- **Invariant Verification**: ANSWER_WORDS ⊆ GUESS_WORDS maintained

### Milestone 4.12: ETH/USD Price Integration (CoinGecko)
- **CoinGecko Integration**: Live ETH/USD price fetching via free API
- **Price Module**: New `src/lib/prices.ts` with `getEthUsdPrice()` function
- **60-Second Caching**: Client-side caching to avoid rate limits
- **Graceful Fallback**: Uses last cached price on API errors
- **No Configuration**: Zero API keys required, works out of the box
- **Dev Mode Support**: Live prices in all dev modes (LHAW_DEV_MODE, NEXT_PUBLIC_TEST_MID_ROUND)
- **UI Updates**: Top ticker displays "0.123 ETH ($421.50)" format
- **Formatting**: USD always shows 2 decimal places for cents
- **Error Handling**: Never blocks UI, shows ETH only if price unavailable

### Milestone 5.1: Farcaster Announcer Bot
- **Status**: ✅ Complete
- Announcer bot account: @letshaveaword (FID 1477413)
- Neynar signer integration
- Automated announcements:
  - postRoundStarted() - New round notifications
  - postRoundResolved() - Winner announcements with commit-reveal verification
  - postMilestoneJackpot() - Prize pool milestones (0.1, 0.25, 0.5, 1.0 ETH)
  - postMilestoneGuesses() - Guess count milestones (100, 500, 1k, 5k, 10k)
  - postReferralWin() - Referral bonus highlights (threaded reply)
- Dev mode safety: announcements disabled when NODE_ENV !== 'production'
- Idempotent via announcer_events table

### Milestone 5.2: Analytics & Tracking
- **Status**: ✅ Complete
- Analytics infrastructure:
  - analytics_events table with JSONB data
  - Fire-and-forget event logging (non-blocking)
  - Events: daily_open, free_guess_used, paid_guess_used, round_started, round_resolved, share_bonus_unlocked, referral_join, referral_win
- Analytics views:
  - view_dau - Daily Active Users
  - view_wau - Weekly Active Users (ISO week)
  - view_free_paid_ratio - Free vs paid guess breakdown
  - view_jackpot_growth - Prize pool evolution
  - view_referral_funnel - Referral metrics
- Admin dashboard at /admin/analytics with Neynar SIWN authentication

### Milestone 5.3: Advanced Analytics & Fairness Systems
- **Status**: ✅ Complete
- **Fairness Monitoring** (`src/services/fairness-monitor/`):
  - Continuous commit-reveal validation: H(salt || answer) === commitHash
  - Transaction-level prize audit against economic rules (80/10/10 split)
  - Suspicious sequence detection (same winner, same answer patterns)
  - Automated FAIRNESS_ALERT_* event logging
- **User Quality Gating** (`src/lib/user-quality.ts`):
  - Neynar User Score ≥ 0.6 required to submit guesses
  - ~307,775 eligible Farcaster users (Nov 2024)
  - 24-hour score caching with automatic refresh
  - USER_QUALITY_BLOCKED event logging for blocked attempts
- **Adversarial Simulation Engine** (`src/services/simulation-engine/`):
  - `wallet_clustering` - Detect sybil attacks (shared wallets, referral chains)
  - `rapid_winner` - Model improbable win streaks
  - `frontrun_risk` - Assess commit-reveal vulnerabilities
  - `jackpot_runway` - Project prize pool sustainability under stress
  - `full_suite` - Combined risk report
- **Enhanced Analytics Events**:
  - FAIRNESS_ALERT_HASH_MISMATCH, FAIRNESS_ALERT_PAYOUT_MISMATCH
  - SIM_STARTED, SIM_COMPLETED, CLUSTER_ALERT, RAPID_FIRE_ALERT
  - USER_QUALITY_BLOCKED, USER_QUALITY_REFRESHED
  - GUESS_PACK_USED (with credits_remaining, round_id, fid)
  - SHARE_SUCCESS (with cast hash)
- **New API Endpoints**:
  - GET/POST /api/admin/analytics/fairness - Fairness audits
  - POST /api/admin/analytics/simulations - Run simulations
  - GET /api/admin/analytics/performance - CLANKTON advantage & referral metrics
  - POST /api/admin/analytics/export - CSV/JSON data export
- **Admin Dashboard Enhancements**:
  - Fairness & Integrity section with alert monitoring
  - User Quality Gating metrics (average score, eligible/blocked)
  - CLANKTON holder solve-rate advantage
  - Referral performance (guesses, wins, payouts, top referrers)
  - Guess distribution histogram
  - Simulation controls and results viewer
- **Database Updates**:
  - user_score (DECIMAL 5,3) on users table
  - user_score_updated_at (TIMESTAMP) for cache management
- **Configuration**:
  - USER_QUALITY_GATING_ENABLED=true to enable anti-bot protection

### Milestone 5.4: Round Archive
- **Status**: ✅ Complete
- **Database Schema** (`src/db/schema.ts`):
  - `round_archive` table with roundNumber, targetWord, seedEth, finalJackpotEth, totalGuesses, uniquePlayers, winnerFid, winnerCastHash, winnerGuessNumber, startTime, endTime, referrerFid, payoutsJson, salt, clanktonBonusCount, referralBonusCount
  - `round_archive_errors` table for tracking archiving anomalies
  - Index on `round_number` for fast lookups
  - Migration: `drizzle/0002_round_archive.sql`
- **Archive Logic** (`src/lib/archive.ts`):
  - `archiveRound({ roundId })` - Archives a resolved round with computed stats
  - `syncAllRounds()` - Archives all unarchived resolved rounds
  - `getArchivedRound(roundNumber)` - Fetch specific round
  - `getArchivedRounds({ limit, offset, orderBy })` - Paginated list
  - `getLatestArchivedRound()` - Most recent round
  - `getArchiveDebugInfo(roundNumber)` - Compare archived vs raw data
  - `getRoundGuessDistribution(roundNumber)` - Hour-by-hour histogram
  - `getArchiveStats()` - Aggregate statistics
  - Idempotent archiving (safe to call multiple times)
- **Public API Endpoints**:
  - `GET /api/archive/latest` - Latest archived round
  - `GET /api/archive/:roundNumber` - Specific round (optional `?distribution=true`)
  - `GET /api/archive/list` - Paginated list (optional `?stats=true`)
- **Admin API Endpoints**:
  - `POST /api/admin/archive/sync` - Archive all rounds (optional `{ roundId }` for specific)
  - `GET /api/admin/archive/debug/:roundNumber` - Debug info with discrepancies
  - `GET /api/admin/archive/errors` - View archive errors
- **Admin Dashboard** (`pages/admin/archive.tsx`):
  - Statistics overview (total rounds, guesses, winners, jackpot distributed)
  - Paginated round table with click-to-detail
  - Detail view: winner info, payouts, guess distribution histogram
  - Sync controls and error monitoring
- **Player UI**:
  - `/archive` - Browse rounds with pagination, aggregate stats
  - `/archive/:roundNumber` - Round detail with word, jackpot, winner, distribution
  - Dark theme matching game UI
  - Commit-reveal verification (displays salt)
- **Error Handling**:
  - Errors stored in `round_archive_errors` table
  - Debug endpoint detects discrepancies between archived and raw data

### Planned Milestones (6.1 - 6.2)

### Milestone 6.1: Smart Contract Integration
- **Status**: Not started
- **Smart Contract Development**:
  - Paid guess escrow contract
  - Automated payout function
  - Purchase event handling
  - Creator withdrawal mechanism
- Contract testing and auditing
- Testnet deployment and validation
- Mainnet deployment

### Milestone 6.2: Optional / Future Enhancements
- **Status**: Wishlist
- Domain acquisition (http://letshaveaword.fun)
- Multi-wallet CLANKTON support (check all verified addresses)
- XP system v2 with progression paths
- Global leaderboards and rankings
- Localization support (i18n)
- Custom animations and transitions
- Achievement badge system
- Unlockable rewards and perks

---

## Development Workflow

### Local Development
```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your values

# Run dev server
npm run dev

# Open browser
http://localhost:3000
```

### Dev Mode Testing
```bash
# Enable dev mode
LHAW_DEV_MODE=true
LHAW_DEV_FIXED_SOLUTION=CRANE

# Test interactive play
# Type words, submit guesses
# CRANE wins, others are wrong

# Test preview mode
LHAW_DEV_FORCE_STATE_ENABLED=true

# Then use URLs:
/?devState=RESULT_CORRECT&devInput=CRANE
/?devState=RESULT_WRONG_VALID&devInput=BRAIN
/?devState=OUT_OF_GUESSES
```

### Building for Production
```bash
# Type check
npm run build

# Deploy to Vercel
vercel --prod
```

### Database Management
```bash
# Generate migrations
npm run drizzle-kit generate

# Apply migrations
npm run drizzle-kit push

# Studio (GUI)
npm run drizzle-kit studio
```

---

## Common Patterns

### Adding a New Word to Wheel
```typescript
// Frontend tracks wrong guesses
setDevWrongGuesses(prev => new Set([...prev, word.toLowerCase()]));

// Wheel auto-updates via useEffect
const allWords = [...baseWords, ...Array.from(devWrongGuesses)];
const uniqueWords = Array.from(new Set(allWords));
const sortedWords = uniqueWords.sort();
setWheelWords(sortedWords);
```

### Checking User Has Guesses
```typescript
// Fetch user state
const response = await fetch(`/api/user-state?devFid=${fid}`);
const data: UserStateResponse = await response.json();

// Check totals
const hasGuesses = data.totalGuessesRemaining > 0;

// Disable input if no guesses
<input disabled={!hasGuesses} />
```

### Adding a New Input State
```typescript
// 1. Add to InputState type
export type InputState =
  | 'EXISTING_STATES'
  | 'NEW_STATE';

// 2. Add to getInputState() logic
if (someCondition) {
  return 'NEW_STATE';
}

// 3. Add border color
export function getBoxBorderColor(state: InputState) {
  if (state === 'NEW_STATE') {
    return 'border-purple-500';
  }
  // ...
}

// 4. Add error message
export function getErrorMessage(state: InputState) {
  if (state === 'NEW_STATE') {
    return 'New state error message';
  }
  // ...
}
```

### Deploying to Vercel
```bash
# Link project
vercel link

# Set environment variables in Vercel dashboard
# Deploy
vercel --prod

# Check deployment
vercel inspect <deployment-url>
```

---

## Troubleshooting

### Dev Mode Not Working
1. Check `LHAW_DEV_MODE=true` in environment
2. Verify no database connection errors in logs
3. Look for 🎮 emoji in API logs
4. Check browser console for errors

### Wheel Not Sorting Alphabetically
1. Verify words are lowercase in API response
2. Check `devWrongGuesses` Set is updating
3. Ensure `wheelWords.sort()` is called
4. Check case-insensitive comparison in Wheel component

### Wrong Guesses Not Appearing
1. Check `setDevWrongGuesses()` is called on incorrect guess
2. Verify `useEffect` dependency array includes `devWrongGuesses`
3. Check API returns sorted words
4. Ensure no duplicate filtering removing the word

### Share Modal Not Showing
1. Check 2-second delay `setTimeout(..., 2000)`
2. Verify `setPendingShareResult()` is called
3. Ensure guess status is 'correct' or 'incorrect'
4. Check modal state: `showShareModal`

### Case-Sensitivity Issues
1. Always normalize to lowercase for comparisons
2. Display in uppercase for UI
3. Store in lowercase in database
4. Use `.toLowerCase()` for all string comparisons

---

## Analytics (Milestone 5.2)

### Overview

**Let's Have A Word** includes a comprehensive analytics system for tracking user activity, game metrics, and business intelligence. The system is built with a fire-and-forget design to ensure analytics never block or interfere with core game functionality.

### Analytics Events

All analytics events are logged to the `analytics_events` table with the following structure:

```typescript
{
  id: number;              // Auto-increment primary key
  eventType: string;       // Event identifier (see types below)
  userId: string | null;   // FID as string
  roundId: string | null;  // Round ID as string
  data: any;              // JSONB payload with event-specific data
  createdAt: Date;        // Timestamp
}
```

#### Event Types

**User Activity:**
- `daily_open` - User opens the app (first action of day)
- `free_guess_used` - Free guess consumed
  - Data: `{ word, isCorrect, totalGuesses }`
- `paid_guess_used` - Paid guess consumed
  - Data: `{ word, isCorrect, totalGuesses, ethSpent }`
- `GUESS_PACK_USED` - Paid guess credit consumed (Milestone 5.3)
  - Data: `{ credits_remaining, fid, round_id }`

**Referrals:**
- `referral_join` - New user joined via referral link
  - Data: `{ referrerFid }`
- `referral_win` - Referred user won the jackpot
  - Data: `{ referrerFid, roundId }`
- `share_bonus_unlocked` - User unlocked share bonus (+1 free guess)
  - Data: `{ bonusGuesses }`
- `SHARE_SUCCESS` - User shared to Farcaster (Milestone 5.3)
  - Data: `{ castHash, bonusAwarded, newFreeGuessesRemaining }`

**Rounds:**
- `round_started` - New round created
  - Data: `{ prizePoolEth, commitHash }`
- `round_resolved` - Round completed with winner
  - Data: `{ winnerFid, referrerFid, prizePoolEth, seedNextRoundEth }`

**Fairness & Integrity (Milestone 5.3):**
- `FAIRNESS_ALERT_HASH_MISMATCH` - Critical: commit hash doesn't match
  - Data: `{ roundId, expected, actual, severity }`
- `FAIRNESS_ALERT_PAYOUT_MISMATCH` - High: payout amounts incorrect
  - Data: `{ roundId, expected, actual, difference }`
- `FAIRNESS_ALERT_SUSPICIOUS_SEQUENCE` - Medium: suspicious pattern
  - Data: `{ pattern, roundIds, details }`
- `PRIZE_AUDIT_MISMATCH` - Prize pool doesn't match paid guesses
  - Data: `{ roundId, expectedPool, actualPool }`
- `FAIRNESS_AUDIT_COMPLETED` - Full audit completed
  - Data: `{ roundsChecked, issuesFound, duration }`

**Simulations (Milestone 5.3):**
- `SIM_STARTED` - Simulation run started
  - Data: `{ type, options }`
- `SIM_COMPLETED` - Simulation run completed
  - Data: `{ type, duration, riskScore }`
- `CLUSTER_ALERT` - Wallet clustering detected sybil attack
  - Data: `{ clusterSize, suspiciousFids, riskScore }`
- `RAPID_FIRE_ALERT` - Suspicious win pattern detected
  - Data: `{ winnerFid, winCount, probability }`
- `FRONTRUN_RISK` - Front-run vulnerability assessment
  - Data: `{ attackVector, riskLevel, recommendation }`
- `RUNWAY_WARNING` - Jackpot sustainability warning
  - Data: `{ daysToDepletion, sustainabilityScore }`

**User Quality (Milestone 5.3):**
- `USER_QUALITY_BLOCKED` - User blocked due to low score
  - Data: `{ fid, score, minRequired, action }`
- `USER_QUALITY_REFRESHED` - User score refreshed
  - Data: `{ fid, previousScore, newScore }`

### Metrics

The analytics system provides the following aggregated metrics through SQL views:

#### DAU (Daily Active Users)
- **View:** `view_dau`
- **Columns:** `day`, `active_users`
- **Definition:** Count of distinct `user_id` with any event on each day
- **Use Case:** Track daily engagement and growth

#### WAU (Weekly Active Users)
- **View:** `view_wau`
- **Columns:** `week_start`, `active_users`
- **Definition:** Count of distinct `user_id` per ISO week
- **Use Case:** Track weekly engagement trends

#### Free/Paid Ratio
- **View:** `view_free_paid_ratio`
- **Columns:** `day`, `free_guesses`, `paid_guesses`, `free_to_paid_ratio`
- **Definition:** Breakdown of free vs paid guess usage per day
- **Use Case:** Monitor monetization and conversion rates

#### Jackpot Growth
- **View:** `view_jackpot_growth`
- **Columns:** `day`, `round_id`, `jackpot_eth`, `winner_fid`
- **Definition:** Prize pool amounts from round resolution events
- **Use Case:** Track jackpot evolution and winner patterns

#### Referral Funnel
- **View:** `view_referral_funnel`
- **Columns:** `day`, `referral_shares`, `referral_joins`, `referral_wins`, `bonus_unlocked`
- **Definition:** Referral metrics aggregated per day
- **Use Case:** Measure referral program effectiveness

### Implementation Details

#### Logging Helper

The `src/lib/analytics.ts` module provides the core logging functionality:

```typescript
import { logAnalyticsEvent, AnalyticsEventTypes } from './analytics';

// Log a user activity event
await logAnalyticsEvent(AnalyticsEventTypes.FREE_GUESS_USED, {
  userId: fid.toString(),
  roundId: roundId.toString(),
  data: { word: 'CRANE', isCorrect: false },
});
```

**Helper Functions:**
- `logAnalyticsEvent(eventType, options)` - General purpose logger
- `logUserActivity(eventType, userId, data)` - User-specific events
- `logRoundEvent(eventType, roundId, data)` - Round-specific events
- `logGuessEvent(isPaid, userId, roundId, data)` - Guess-specific events
- `logReferralEvent(eventType, userId, data)` - Referral-specific events

#### Integration Points

Analytics logging is integrated at the following points:

1. **Rounds** (`src/lib/rounds.ts`)
   - `createRound()` → logs `round_started`
   - `resolveRound()` → logs `round_resolved`

2. **Guesses** (`src/lib/guesses.ts`)
   - `submitGuess()` → logs `free_guess_used` or `paid_guess_used`
   - Correct guess with referrer → logs `referral_win`

3. **Users** (`src/lib/users.ts`)
   - `upsertUserFromFarcaster()` → logs `referral_join` (if referred)

4. **Daily Limits** (`src/lib/daily-limits.ts`)
   - `awardShareBonus()` → logs `share_bonus_unlocked`

#### Fire-and-Forget Design

All analytics logging follows these principles:

1. **Non-blocking:** Analytics calls never `await` or block user flows
2. **Error-tolerant:** Wrapped in try-catch, failures logged but not thrown
3. **Feature-flagged:** Respects `ANALYTICS_ENABLED` env var
4. **Debug-friendly:** Optional verbose logging via `ANALYTICS_DEBUG`

Example:
```typescript
// Good: Fire-and-forget
logAnalyticsEvent(AnalyticsEventTypes.ROUND_STARTED, { roundId });

// Bad: Blocking
await logAnalyticsEvent(AnalyticsEventTypes.ROUND_STARTED, { roundId });
```

### Admin Dashboard

The analytics dashboard is accessible at `/admin/analytics` (web-only, not in mini app).

#### Authentication

- Uses **Neynar SIWN** (Sign In With Neynar)
- Only FIDs in `LHAW_ADMIN_USER_IDS` can access
- Session validated on every API call

#### Dashboard Tabs

1. **DAU** - Daily active users table
2. **WAU** - Weekly active users table
3. **Free/Paid Ratio** - Free vs paid guess breakdown
4. **Jackpot Growth** - Prize pool evolution
5. **Referral Funnel** - Referral metrics
6. **Raw Events** - Paginated event log with expandable JSON

#### API Endpoints

- `GET /api/admin/me` - Check admin status
- `GET /api/admin/analytics/dau` - DAU data
- `GET /api/admin/analytics/wau` - WAU data
- `GET /api/admin/analytics/free-paid` - Free/paid ratio
- `GET /api/admin/analytics/jackpot` - Jackpot growth
- `GET /api/admin/analytics/referral` - Referral funnel
- `GET /api/admin/analytics/events` - Raw events (paginated)

All endpoints:
- Require admin FID check
- Return empty array if `ANALYTICS_ENABLED !== 'true'`
- Return 403 if not admin

### Dev Notes

#### Adding a New Analytics Event

1. Add event type to `AnalyticsEventTypes` in `src/lib/analytics.ts`:
   ```typescript
   export const AnalyticsEventTypes = {
     // ...existing events
     NEW_EVENT: 'new_event',
   } as const;
   ```

2. Call `logAnalyticsEvent()` from appropriate backend handler:
   ```typescript
   import { logAnalyticsEvent, AnalyticsEventTypes } from './analytics';

   // In your handler function
   logAnalyticsEvent(AnalyticsEventTypes.NEW_EVENT, {
     userId: fid.toString(),
     data: { key: 'value' },
   });
   ```

3. (Optional) Extend views/dashboard to display the new event:
   - Add SQL to `drizzle/0001_analytics_views.sql`
   - Create new API endpoint in `pages/api/admin/analytics/`
   - Add new tab to `pages/admin/analytics.tsx`

#### Testing Analytics in DEV MODE

1. Set environment variables:
   ```bash
   ANALYTICS_ENABLED=true
   ANALYTICS_DEBUG=true  # Optional: verbose logs
   LHAW_ADMIN_USER_IDS=12345  # Your FID
   ```

2. Trigger events by using the app normally

3. Check database:
   ```sql
   SELECT * FROM analytics_events ORDER BY created_at DESC LIMIT 10;
   ```

4. Access dashboard:
   ```
   http://localhost:3000/admin/analytics?devFid=12345
   ```

#### Database Maintenance

**Archiving old events:**
```sql
-- Archive events older than 90 days
CREATE TABLE analytics_events_archive AS
SELECT * FROM analytics_events
WHERE created_at < NOW() - INTERVAL '90 days';

DELETE FROM analytics_events
WHERE created_at < NOW() - INTERVAL '90 days';
```

**Refreshing views:**
Views are non-materialized and automatically update. No refresh needed.

### Configuration

**Environment Variables:**
- `ANALYTICS_ENABLED` - Master on/off switch (default: `false`)
- `ANALYTICS_DEBUG` - Verbose logging (default: `false`)
- `LHAW_ADMIN_USER_IDS` - Comma-separated FIDs (e.g., `6500,1477413`)
- `NEXT_PUBLIC_NEYNAR_CLIENT_ID` - Neynar client ID (public)
- `NEYNAR_API_KEY` - Neynar API key (server-side)

**Neynar SIWN Setup:**
- App: "Let's Have A Word!" on Neynar
- Authorized origin: `https://lets-have-a-word.vercel.app`
- Permissions: Read + Write (Write required for SIWN)

---

## Fairness & Integrity Systems (Milestone 5.3)

### Overview

Milestone 5.3 implements comprehensive game integrity protections including fairness monitoring, user quality gating, and adversarial simulations.

### User Quality Gating

To prevent bot/sybil abuse, only Farcaster users with sufficient reputation can play.

**Requirement:** Neynar User Score ≥ 0.6

**Implementation:** `src/lib/user-quality.ts`

```typescript
import { checkUserQuality, logBlockedAttempt } from './user-quality';

// Check if user can play
const result = await checkUserQuality(fid);

if (!result.eligible) {
  // User blocked - low quality score
  await logBlockedAttempt(fid, result.score, 'guess');
  return { error: 'INSUFFICIENT_USER_SCORE', score: result.score };
}

// User can proceed
```

**Key Functions:**
- `checkUserQuality(fid, forceRefresh?)` - Check eligibility with caching
- `logBlockedAttempt(fid, score, action)` - Log blocked attempt for analytics
- `batchRefreshUserScores(fids)` - Batch refresh for cron job
- `getUserQualityStats()` - Get aggregate statistics

**Caching:**
- Scores cached in `users.user_score` column
- Cache duration: 24 hours (`SCORE_CACHE_DURATION_MS`)
- Automatic refresh when cache expires
- Manual refresh with `forceRefresh: true`

**Error Response:**
```json
{
  "error": "INSUFFICIENT_USER_SCORE",
  "message": "Your Farcaster reputation score (0.45) is below the minimum required (0.6)...",
  "score": 0.45,
  "minRequired": 0.6,
  "helpUrl": "https://docs.neynar.com/docs/user-scores"
}
```

**Configuration:**
- Enable: `USER_QUALITY_GATING_ENABLED=true`
- Threshold: 0.6 (configurable in `MIN_USER_SCORE` constant)

### Fairness Monitoring

Validates game integrity by checking commit-reveal pairs and payout amounts.

**Implementation:** `src/services/fairness-monitor/index.ts`

**Key Functions:**

```typescript
import {
  validateRoundCommitment,
  validateRoundPayouts,
  runFairnessAudit,
  detectSuspiciousSequences
} from './services/fairness-monitor';

// Validate a single round
const result = await validateRoundCommitment(roundId);
// Returns: { roundId, isValid, commitHashValid, payoutValid, errors, warnings }

// Run full audit
const report = await runFairnessAudit({
  startDate: new Date('2024-01-01'),
  endDate: new Date(),
});

// Detect suspicious patterns
const suspicions = await detectSuspiciousSequences(100); // last 100 rounds
```

**What Gets Validated:**
1. **Commit Hash**: Verifies `H(salt || answer) === commitHash`
2. **Payout Amounts**: Ensures 80/10/10 split is correct
3. **Prize Pool Growth**: Verifies paid guesses → pool accumulation
4. **Win Patterns**: Detects statistically improbable sequences

**Alert Events:**
- `FAIRNESS_ALERT_HASH_MISMATCH` - Critical: commit hash invalid
- `FAIRNESS_ALERT_PAYOUT_MISMATCH` - High: payout calculation error
- `FAIRNESS_ALERT_SUSPICIOUS_SEQUENCE` - Medium: suspicious pattern

### Prize Audit System

Cross-checks prize amounts against expected economic rules.

**Implementation:** `src/services/fairness-monitor/prize-audit.ts`

**Economic Rules Verified:**
```typescript
const ECONOMIC_RULES = {
  GUESS_PRICE_ETH: 0.0003,      // Price per paid guess
  PRIZE_POOL_SHARE: 0.8,        // 80% to prize pool
  SEED_CREATOR_SHARE: 0.2,      // 20% to seed/creator
  WINNER_SHARE: 0.8,            // 80% of jackpot to winner
  REFERRER_SHARE: 0.1,          // 10% to referrer
  TOP_GUESSERS_SHARE: 0.1,      // 10% to top guessers
  SEED_CAP_ETH: 0.03,           // 0.03 ETH seed cap
};
```

**Key Functions:**
- `auditPrizePoolGrowth(roundId)` - Verify prize pool against paid guesses
- `runPrizeAudit(options)` - Full prize audit across rounds
- `getPrizeAuditSummary()` - Get aggregate payout statistics

### Adversarial Simulation Engine

Models attack vectors and stress scenarios to identify vulnerabilities.

**Implementation:** `src/services/simulation-engine/index.ts`

**Available Simulations:**

| Type | Purpose | Risk Factors |
|------|---------|--------------|
| `wallet_clustering` | Detect sybil attacks | Shared wallets, referral chains, timing |
| `rapid_winner` | Flag improbable wins | Win frequency, statistical probability |
| `frontrun_risk` | Assess commit-reveal | Pre-image attacks, timing attacks |
| `jackpot_runway` | Project sustainability | Growth rate, depletion scenarios |
| `full_suite` | Combined analysis | All risk factors |

**Running Simulations:**

```typescript
import { runSimulation, runFullSimulationSuite } from './services/simulation-engine';

// Run single simulation
const result = await runSimulation('wallet_clustering', {
  lookbackRounds: 100,
});

// Run all simulations
const fullReport = await runFullSimulationSuite();
```

**Via API:**
```bash
curl -X POST /api/admin/analytics/simulations \
  -H "Content-Type: application/json" \
  -d '{"type": "full_suite"}'
```

**Wallet Clustering Output:**
```typescript
interface WalletClusterResult {
  clusters: WalletCluster[];      // Detected clusters
  totalUsersAnalyzed: number;
  suspiciousUserCount: number;
  clusterRiskScore: number;       // 0-100 risk score
}
```

**Jackpot Runway Output:**
```typescript
interface RunwayResult {
  currentJackpot: number;
  projectedRounds: RunwayProjection[];
  sustainabilityScore: number;    // 0-100
  daysToDepletion: number | null;
  scenarioResults: EconomicScenario[];
}
```

### Admin Dashboard Enhancements

The admin dashboard at `/admin/analytics` includes new sections for Milestone 5.3:

**Fairness & Integrity Section:**
- Overall fairness status indicator (healthy/warning/critical)
- Recent alerts count with severity breakdown
- Prize audit summary (total distributed, average jackpot)
- Recent alerts list with expandable details

**User Quality Gating Section:**
- Average user score across all users
- Eligible vs blocked user counts
- Total blocked attempts
- Recent blocked attempts list

**Referral Performance Section:**
- Total referrals and referral-generated guesses
- Referral wins and total payouts
- Top referrers table (FID, referrals, wins, earnings)

**Adversarial Simulations Section:**
- Simulation type selector
- Run simulation button with loading state
- Results display with risk scores
- Historical simulation results

**Guess Distribution Section:**
- Histogram of guesses to solve (1-5, 6-10, 11-20, etc.)
- Median and mean guesses statistics
- CLANKTON holder advantage comparison

### Code Architecture Notes

**CRITICAL: Provider Scoping (BUG FIX #5 - 2025-11-24) - FINAL FIX**

To prevent server-side bundling issues with `@farcaster/miniapp-sdk`, providers are scoped to specific pages:

**Provider Architecture:**

- **`pages/_app.tsx`**: Minimal, NO providers
  - Only imports global styles (`globals.css`)
  - Does NOT wrap pages with any providers (no WagmiProvider, no QueryClientProvider)
  - Clean pass-through to page components

- **`pages/index.tsx`** (Game page):
  - Wraps `GameContent` with `WagmiProvider` + `QueryClientProvider`
  - Imports `@farcaster/miniapp-sdk` for Farcaster mini-app functionality
  - Uses `@farcaster/miniapp-wagmi-connector` for wallet connection
  - Scoped to game page ONLY

- **`pages/admin/analytics.tsx`** (Admin page):
  - Wraps dashboard with `NeynarContextProvider` for SIWN authentication
  - ZERO dependency on Farcaster miniapp ecosystem
  - No wagmi, no miniapp SDK, no game components
  - Uses standard React Query for analytics API calls

**SDK Import Restrictions:**

The `@farcaster/miniapp-sdk` is a client-side only library designed for the Farcaster mini-app runtime. It is **NOT compatible with Node.js server environments**.

**Where to import `@farcaster/miniapp-sdk`:**
- ✅ `pages/index.tsx` (main game page)
- ✅ Game-specific components (SharePromptModal, WinnerShareCard, StatsSheet, FAQSheet, etc.)
- ✅ `src/lib/haptics.ts` (used only by game components)
- ✅ Client-side only code that runs in the Farcaster frame

**Where to NEVER import `@farcaster/miniapp-sdk`:**
- ❌ `pages/_app.tsx` (would bundle SDK for ALL pages)
- ❌ `pages/admin/*` (admin pages use SIWN, not miniapp context)
- ❌ `pages/api/*` (server-side API routes)
- ❌ `src/config/wagmi.ts` should NOT be imported by `_app.tsx`
- ❌ Any shared utilities used by both game and admin pages

**Why This Matters:**

- The miniapp SDK is **client-side only** and NOT compatible with Node.js server environment
- `@farcaster/miniapp-wagmi-connector` has `@farcaster/miniapp-sdk` as a peer dependency
- If `wagmi` config is in `_app.tsx`, the SDK gets bundled for ALL pages including admin
- This causes "SyntaxError: Cannot use import statement outside a module" errors in Vercel SSR
- Admin analytics must have ZERO dependency on the Farcaster ecosystem

**Root Cause of Previous Issues:**

1. **BUG FIX #4**: SDK was imported directly in `_app.tsx` → Removed import
2. **BUG FIX #5**: `WagmiProvider` was in `_app.tsx`, which imported wagmi config, which imported `@farcaster/miniapp-wagmi-connector`, which has miniapp SDK as peer dependency → Moved WagmiProvider to `pages/index.tsx` only

**Bug Fix Reference:** See `pages/_app.tsx` header comment (BUG FIX #5) and `pages/index.tsx` for detailed architecture.

---

## Future Considerations

### Potential Enhancements
- **Leaderboard**: Global rankings by XP, wins, streak
- **Streak Tracking**: Daily play streaks with bonuses
- **Power-Ups**: Special abilities (reveal letter, eliminate word)
- **Tournaments**: Special rounds with higher stakes
- **NFT Integration**: Badge NFTs for achievements
- **Multi-Round Gameplay**: Progressive difficulty
- **Hint System**: Buy hints with XP or ETH
- **Social Features**: Friend challenges, group rounds

### Scalability
- **Caching**: Redis for round state, wheel words
- **CDN**: Static assets on edge network
- **Database Indexing**: Optimize frequent queries
- **Rate Limiting**: Prevent spam/abuse
- **Queue System**: Handle high-volume submissions

### Security
- **Sybil Resistance**: Prevent multi-account farming
- **Front-Running Protection**: Commit-reveal enforcement
- **Prize Pool Safety**: Multi-sig wallet for funds
- **Smart Contract Audit**: Before mainnet launch
- **Bot Detection**: Honeypot words, timing analysis

---

## Contact & Resources

### Documentation
- This file: `GAME_DOCUMENTATION.md`
- Environment setup: `.env.example`
- Database schema: `src/db/schema.ts`

### External Links
- Farcaster Docs: https://docs.farcaster.xyz/
- Drizzle ORM: https://orm.drizzle.team/
- Next.js: https://nextjs.org/docs
- Tailwind CSS: https://tailwindcss.com/docs

### Repository
- GitHub: [Your repo URL]
- Deployment: Vercel
- Database: Neon PostgreSQL

---

**Last Updated**: November 2025
**Version**: 5.3 (Milestone 5.3 - Advanced Analytics & Fairness Systems)
**Status**: Active Development
