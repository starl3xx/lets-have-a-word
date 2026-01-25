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
11. [OG Hunter Prelaunch Campaign](#og-hunter-prelaunch-campaign)
12. [Key Features by Milestone](#key-features-by-milestone)
13. [Daily Guess Flow](#daily-guess-flow)
14. [Guess Packs](#guess-packs)
15. [Share-for-Free-Guess](#share-for-free-guess)
16. [CLANKTON Holder Bonus](#clankton-holder-bonus)
17. [Referral System](#referral-system)
18. [XP & Progression (v1)](#xp--progression-v1)
19. [UX Design Guidelines](#ux-design-guidelines)

---

## Game Overview

**Let's Have A Word** is a social word-guessing game built on Farcaster where players compete to guess a secret 5-letter word. Every wrong guess helps narrow the field, and one correct guess wins the ETH jackpot.

### Core Concept
- **Secret Word**: Each round has a hidden 5-letter word
- **Collaborative Elimination**: Wrong guesses are shared publicly, helping everyone
- **Single Winner**: First person to guess correctly wins the entire prize pool
- **Provably Fair**: Answer hash committed onchain before guessing begins, verifiable at `/verify`

### Key Differentiators
- **Social Deduction**: Wrong guesses benefit everyone
- **Real ETH Stakes**: Prize pool grows with paid guesses
- **Referral System**: Earn 10% of your referrals' winnings
- **CLANKTON Bonus**: Token holders get +2-3 daily guesses (scales with market cap)

---

## Game Mechanics

### Daily Guess Allocation
Each player gets a daily allocation of guesses:
- **Base Free Guesses**: 1 per day
- **CLANKTON Bonus**: +2-3 if holding 100M+ CLANKTON tokens (tiered by market cap)
  - +2 guesses/day when market cap < $250k
  - +3 guesses/day when market cap >= $250k
- **Share Bonus**: +1 for sharing to Farcaster (once per day)
- **Paid Guess Packs**: Buy 3 guesses per pack (unlimited packs, volume pricing applies)

**Total Possible Daily Guesses**: Unlimited (1 base + 2-3 CLANKTON + 1 share + unlimited paid)

### Prize Pool Economics (Updated January 2026)

**Jackpot Distribution** (when round is won):
- **80%**: Winner (jackpot)
- **10%**: Top 10 Early Guessers (guesses 1-850 only, weighted by rank)
- **5%**: Next Round Seed (capped at 0.03 ETH, overflow → creator)
- **5%**: Referrer (if winner has one)

**When no referrer exists**:
- Referrer's 5% is split: 2.5% → Top 10 pool (12.5% total), 2.5% → Seed (7.5% total)

### Round Lifecycle
1. **Round Creation**: Answer selected (cryptographically random), hash committed onchain
2. **Guessing Phase**: Players submit guesses (valid 5-letter words only)
3. **Wrong Guesses**: Added to public wheel, visible to all players
4. **Correct Guess**: Round ends, winner determined, payouts processed onchain
5. **Resolution**: Answer + salt revealed, verifiable at `/verify?round=N`

### Word Validation
- Must be exactly **5 letters**
- Must be in the **WORDS** dictionary (4,439 curated words)
- Unified list: same words for guessing and answers (Milestone 7.1)
- Cannot guess the same word twice in a round
- Case-insensitive (BRAIN = brain = BrAiN)
- All words normalized to UPPERCASE internally

### Per-User Per-Day Random Wheel Start Position

The word wheel displays all 4,439 possible guess words. To provide variety and prevent pattern recognition, each user sees a different starting position in the wheel.

**Production Behavior:**
- Random starting index generated **once per day** at 11:00 UTC per user
- Persisted in database (`dailyGuessState.wheelStartIndex`)
- Stable across all page refreshes throughout the day
- Ensures consistent UX for the same user on the same day
- Optionally resets per round if configured

**Dev Mode Behavior:**
- Random starting index generated **on every page load**
- Does NOT persist or reuse from database
- Helps with faster testing and UX iteration
- Allows developers to quickly test different wheel positions and animations

Enable dev mode by setting `LHAW_DEV_MODE=true` in your environment variables.

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
│   │   ├── guess_words_clean.ts     # 4,439 unified word list (UPPERCASE)
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

**Features (Milestone 4.11 - Virtualized, 6.4 - Performance Tuned):**
- **Alphabetical Display**: All 4,439 words sorted A-Z
- **Virtual Scrolling**: Renders only ~100 visible words (99% DOM reduction)
- **Fast Rotation**: 200ms CSS transitions with capped scroll animation (100-250ms)
- **Auto-Scrolling**: Jumps to alphabetical position as you type
- **3D Effect**: Scale/opacity/color based on distance from center
- **Dynamic Gap**: 10vh gap where input boxes appear
- **Status-Based Colors**: Unguessed (gray), wrong (red), winner (gold)
- **Binary Search**: O(log n) alphabetical positioning

**Performance (Milestone 6.4):**
- Renders ~100 words instead of all words (99% reduction)
- 60 FPS smooth scrolling
- Instant response to keyboard input
- Custom requestAnimationFrame animation with easeOutCubic easing
- CSS transitions at 200ms (reduced from 300ms)
- Scroll animation capped at 250ms max (A→Z feels same as C→D)
- GPU acceleration via `will-change: transform, opacity`
- Debug mode: `NEXT_PUBLIC_WHEEL_ANIMATION_DEBUG_SLOW=true` slows animations 3x

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

// Custom scroll animation with capped duration (Milestone 6.4)
const animateScrollTo = (targetScrollTop: number, immediate: boolean) => {
  const distance = Math.abs(targetScrollTop - startScrollTop);
  // Duration capped between 100-250ms regardless of distance
  const duration = Math.min(250, Math.max(100, distance * 0.5));
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  // requestAnimationFrame loop for smooth 60fps animation
};

// Dynamic 10vh gap
const GAP_HEIGHT = Math.round(window.innerHeight * 0.10);
```

### Letter Boxes Component (`components/LetterBoxes.tsx`)

**Features (Milestone 4.6, updated 6.4):**
- 5 individual input boxes
- State-based border colors (blue=valid, red=invalid, green=correct)
- Shake animation on invalid input
- Auto-focus management
- Hardware keyboard support

**Tap/Focus Behavior (Milestone 6.4):**
The input row uses a centralized state machine (`useGuessInput` hook) for predictable behavior:

| State | Tap Behavior | Typing Behavior |
|-------|--------------|-----------------|
| Empty row | Focus first box | Fill left-to-right |
| Partial row | Do nothing | Append to first empty |
| Full row | Do nothing | Ignored until backspace |
| Error/red state | Do nothing | Ignored until reset |
| Out of guesses | Do nothing | Ignored (visually disabled) |
| Submitting | Do nothing | Locked during API call |

**Visual Feedback:**
- Locked state: 60% opacity, `cursor-not-allowed`
- Error state: `cursor-default` (no interaction feedback)
- Empty row: `cursor-text` with hover highlight

**Border Color Logic:**
```typescript
TYPING_FULL_VALID          → Blue (#2563eb)
TYPING_FULL_INVALID_*      → Red (#ef4444)
RESULT_CORRECT             → Green (#22c55e)
RESULT_WRONG_VALID         → Red (#ef4444)
OUT_OF_GUESSES             → Gray (#9ca3af)
```

**Hook: `useGuessInput` (Milestone 6.4)**
Centralized input control that returns:
- `canAcceptInput`: Whether new letters are allowed
- `canHandleTap`: Whether box taps should focus input
- `canHandleBackspace`: Whether backspace is allowed
- `isErrorState`: Whether in error (red) state
- `isLockedState`: Whether input is locked
- `handleLetter(letter)`: Returns new letters array or null if blocked
- `handleBackspace()`: Returns new letters array or null if blocked
- `handleBoxTap(index)`: Returns true if tap should focus input

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
- ~250 test words
- ~80 SEED_WORDS
- ~600 extra guess words
- All lowercase, 5 letters
- No overlap between answer/seed

### Dev Mode Persona Switcher (Milestone 6.4.7)

A client-side tool for QA testing different user states without modifying the database.

**Enabling:**
```bash
# Add to .env.local
NEXT_PUBLIC_LHAW_DEV_MODE=true
```

**Usage:**
1. Look for the "DEV" pill button in the top-right corner
2. Click to open the persona panel
3. Select a persona to override user state
4. Button shows "DEV*" (pulsing) when override is active
5. Click "Reset to Real State" to clear overrides

**Available Personas:**

| Persona | Description |
|---------|-------------|
| Real State | Use actual API data (no overrides) |
| New Non-Holder | 1 free guess, share available, no CLANKTON |
| Engaged Non-Holder | Share bonus available, no guesses left |
| Non-Holder Out of Guesses | Share used, no guesses, no packs bought |
| CLANKTON Holder (Low Tier) | +2 bonus guesses, share available |
| CLANKTON Holder (High Tier) | +3 bonus guesses, share available |
| Maxed-Out Buyer | Max packs bought, share used, no guesses |

**Key Files:**
- `src/contexts/DevPersonaContext.tsx` - State management and personas
- `components/DevPersonaPanel.tsx` - UI component
- Integration in `pages/index.tsx`

**Notes:**
- Overrides are client-side only; they don't affect the database
- Overrides persist during the session until manually reset
- When a persona is active, the user state is re-fetched with overrides applied

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

### Unified Word List (Milestone 7.1)

#### WORDS (4,439 words)
Single curated word list for both guessing and answers.
- **File**: `/src/data/guess_words_clean.ts`
- **Format**: UPPERCASE array, derived from category arrays
- **Categories**: CORE_COMMON (3,934), BIG_PLACES (19), COMMON_NAMES (32), MORPHOLOGICAL (402), SLANG_ALLOWLIST (30)
- **Filtering**: BANNED_GUESSES (14 words) excluded automatically
- **Usage**: Secret word selection, guess validation, wheel display

#### Architecture (Milestone 7.1)
- **Single Source of Truth**: One list for all game operations
- **No Separate Answer List**: Any word can be an answer (fair gameplay)
- **Performance**: Uses `Set` for O(1) lookup instead of `includes()`
- **Wheel**: Displays all 4,439 words using virtualization

### Validation Flow (Milestone 7.1)
```typescript
// 1. Length check
if (word.length !== 5) return false;

// 2. Character check
if (!/^[a-zA-Z]+$/.test(word)) return false;

// 3. Dictionary check (UPPERCASE normalization, O(1) Set lookup)
const normalized = word.toUpperCase().trim();
if (!WORDS_SET.has(normalized)) return false;

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

### Mini App Manifest
The app is configured as a Farcaster mini app via `public/.well-known/farcaster.json`:
```json
{
  "frame": {
    "version": "1",
    "name": "Let's Have A Word!",
    "iconUrl": "https://lets-have-a-word.vercel.app/FC-arch-icon.png",
    "homeUrl": "https://lets-have-a-word.vercel.app",
    "splashImageUrl": "https://lets-have-a-word.vercel.app/FC-arch-icon.png",
    "splashBackgroundColor": "#1e3a5f",
    "webhookUrl": "https://api.neynar.com/f/app/{client_id}/event"
  }
}
```

### Push Notifications
Notification tokens are managed via Neynar webhook:
1. User adds mini app via `sdk.actions.addFrame()`
2. Farcaster sends token events to Neynar webhook URL
3. Neynar stores and manages notification tokens
4. Use Neynar API to send notifications:
```typescript
client.publishFrameNotifications({
  targetFids: [],  // empty = all users
  notification: {
    title: "New Round Started!",
    body: "A new word is waiting...",
    target_url: "https://lets-have-a-word.vercel.app",
  }
});
```

### SDK Setup
```typescript
import sdk, { quickAuth } from '@farcaster/miniapp-sdk';

// Get user context
const context = await sdk.context;
const fid = context?.user?.fid;

// Get Quick Auth token for secure API calls
const { token } = await quickAuth.getToken();

// Add mini app (for notifications)
const result = await sdk.actions.addFrame();
if (result.added && result.notificationDetails) {
  // Token managed by Neynar webhook
}
```

### Authentication Flow (Quick Auth)

**SECURITY**: The SDK context FID (`context.user.fid`) is client-side only and can be spoofed. All API calls that need verified identity must use Quick Auth JWT tokens.

**Flow:**
1. App loads in Farcaster mini app
2. SDK provides user context with FID (used for UI display only)
3. Client calls `quickAuth.getToken()` to get cryptographically signed JWT
4. JWT token sent with API requests as `authToken` in request body
5. Server verifies JWT using `@farcaster/quick-auth` package
6. FID extracted from verified JWT payload (`sub` field)
7. Only verified FIDs can perform authenticated actions

**Server-side verification:**
```typescript
import { createClient as createQuickAuthClient } from '@farcaster/quick-auth';

const quickAuthClient = createQuickAuthClient();

// In API handler
const { authToken } = req.body;
const verifyResult = await quickAuthClient.verifyJwt({ token: authToken });
const fid = verifyResult.sub; // Verified FID
```

**Why Quick Auth?**
- **Prevents FID spoofing**: Anyone could previously submit guesses as any user
- **Cryptographic proof**: JWT signed by Farcaster auth server
- **Simple integration**: No nonce management, single token flow
- **Transparent UX**: Token obtained automatically, no user interaction

**Development mode:**
- When `LHAW_DEV_MODE=true`, `devFid` parameter is accepted for testing
- Bypasses Quick Auth verification for local development

### Composer Integration
```typescript
// Share to Farcaster with auto-loading embed (preferred)
await sdk.actions.composeCast({
  text: 'Check out this game!',
  embeds: ['https://letshaveaword.fun'],
});

// For referral shares, use unique referral link as embed
await sdk.actions.composeCast({
  text: 'Join me on Let\'s Have A Word!',
  embeds: [referralLink], // e.g., https://letshaveaword.fun?ref=abc123
});

// Open external URLs (for links that should open in browser)
await sdk.actions.openUrl('https://farcaster.xyz/username/0xhash');
```

### Mini App Embed Meta Tags
For proper embed previews when sharing, the app includes both meta tags in `_document.tsx`:
```html
<meta name="fc:miniapp" content="..." />
<meta name="fc:frame" content="..." />
```

### Share Bonus Flow
1. User submits guess (correct or incorrect)
2. Wait 2 seconds (user reads feedback)
3. Show SharePromptModal
4. User clicks "Share to Farcaster"
5. `composeCast()` opens with text and embed URL
6. Embed auto-loads in Farcaster client
7. After 2-second delay, call `/api/share-callback`
8. Award +1 guess if not already claimed today
9. Update UserState display

### OG Hunter Prelaunch Campaign

The OG Hunter campaign rewards early adopters before the game launches.

**How It Works:**
1. When `NEXT_PUBLIC_PRELAUNCH_MODE=1`, users are redirected to `/splash`
2. Users must complete two actions:
   - Add the mini app (click "Add App" button)
   - Share a cast about the game
3. Completing both actions earns:
   - Permanent "OG Hunter" badge
   - 500 XP bonus

**Splash Page Flow:**
```
User lands on splash → Sees campaign info → Adds app → Shares cast → Badge awarded
```

**UI Feedback:**
- "Add App" button shows immediate "Added!" state on click
- Badge changes to "Verified" after webhook confirmation
- Progress indicators show completion status

**Database Tables:**
- `user_badges` - Stores permanent badge awards (badge_type, fid, awarded_at)
- `og_hunter_cast_proofs` - Stores cast verification (cast_hash, verified_at)
- `users.added_mini_app_at` - Timestamp when user added the app

**API Endpoints:**
- `GET /api/og-hunter/status` - Check user's campaign progress
- `POST /api/og-hunter/verify-cast` - Verify and record cast share
- `POST /api/webhooks/mini-app-added` - Neynar webhook for app additions

**Launching the Game:**
1. Set `NEXT_PUBLIC_PRELAUNCH_MODE=0` in environment
2. Go to `/admin/operations`
3. Click "Start Round" button
4. Round starts with random word and onchain commitment

---

## Key Features by Milestone

### Completed Milestones (1.1 - 5.4)

### Milestone 1.1: Data Model + Rules
- Database schema design (game_rules, users, rounds, guesses)
- JSON ruleset configuration system
- Word list imports (WORDS from guess_words_clean.ts)
- Ruleset management (getRulesForRound)
- Foreign key relationships

### Milestone 1.2: Round Lifecycle
- Round creation with commit-reveal
- Salt generation and SHA-256 hashing
- Random answer selection from WORDS
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
- **Unified Word List**: WORDS (4,439 curated words)
- **UPPERCASE Normalization**: All words stored and validated in UPPERCASE
- **Deprecated SEED_WORDS**: No longer used in game logic
- **Virtual Scrolling**: Renders ~100 visible words (99.5% DOM reduction)
- **Binary Search**: O(log n) alphabetical positioning (750x faster)
- **Performance**: 60 FPS with 4,439 words
- **Fast Rotation**: 150ms animated scroll with visible wheel rotation
- **Dynamic Gap**: 10vh responsive gap height
- **Single List Architecture**: One unified list for guessing and answers

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
  - announceRoundStarted() - New round with hash and verify link
  - announceRoundResolved() - Winner with verify link and top 10 early guessers
  - checkAndAnnounceJackpotMilestones() - Prize pool milestones (0.1, 0.25, 0.5, 1.0 ETH)
  - checkAndAnnounceGuessMilestones() - Guess count milestones (1K, 2K, 3K, 4K)
  - announceReferralWin() - Referral bonus highlights (threaded reply)
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
  - Neynar User Score ≥ 0.55 required to submit guesses
  - Threshold lowered from 0.6 to 0.55 in Jan 2025 to expand eligibility
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

### Milestone 6.3: UX & Growth Mechanics
- **Status**: ✅ Complete
- **Localization Scaffolding**:
  - `locales/en.json` - English translations with all UI strings
  - `locales/base.json` - Template for new locales
  - `src/lib/i18n.ts` - Core i18n implementation with `t()` and `tArray()`
  - `src/hooks/useTranslation.ts` - React hook wrapper for components
  - Browser locale detection with English fallback
- **Guess Pack System**:
  - `GuessPurchaseModal` - Pack selection (1-3 packs), pricing, daily limits
  - `AnotherGuessModal` - "Want another guess?" popup with randomized interjections
  - `/api/guess-pack-pricing` - Pack pricing info endpoint
  - `/api/purchase-guess-pack` - Purchase processing with validation
  - 3-guesses per pack, unlimited purchases with volume pricing
- **Share-for-Free-Guess**:
  - Updated `SharePromptModal` with translation support
  - Farcaster-only share (no X/Twitter for free guess)
  - Once per day limit tracked in `daily_guess_state`
- **Referral UX Polish**:
  - Auto-copy referral link on modal open
  - Animated ETH counter using requestAnimationFrame
  - Analytics event logging (modal open, link copied, share clicked)
- **Stats Page Enhancements**:
  - Guess breakdown (free/bonus/paid)
  - Guesses per round histogram visualization
  - Median guesses to solve
  - Referrals generated this round
- **Share Card Polish**:
  - Purple gradient background with brand colors
  - CLANKTON mascot (🐟) for token holders
  - Jackpot amount display with round number badge
  - Text anti-aliasing for smooth rendering
- **Analytics Events**:
  - `GUESS_PACK_MODAL_OPENED`, `GUESS_PACK_PURCHASED`
  - `ANOTHER_GUESS_MODAL_SHOWN`, `SHARE_FOR_GUESS_CLICKED`, `BUY_PACK_CLICKED`
  - `REFERRAL_MODAL_OPENED`, `REFERRAL_LINK_COPIED`, `REFERRAL_SHARE_CLICKED`
  - `WINNER_SHARE_CARD_SHOWN`, `WINNER_SHARED_FARCASTER`, `WINNER_SHARED_X`
- **Haptic Patterns**:
  - `packPurchased()` - Success notification on purchase
  - `linkCopied()` - Medium impact on copy
  - `shareCompleted()` - Success on share
  - `cardSaved()` - Medium impact on save
  - `losing()` / `winning()` - Game result haptics
- **API Enhancements**:
  - `/api/user-state` - Added `hasSharedToday`, `isClanktonHolder`
  - `/api/user/stats` - Added histogram, median, referrals this round
  - `/api/analytics/log` - Client-side event logging endpoint

### Completed Milestones (6.1 - 6.2)

### Milestone 6.1: Smart Contract Integration
- **Status**: ✅ Complete
- **Smart Contract Development**:
  - JackpotManager contract deployed at `0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5`
  - Automated jackpot distribution
  - CLANKTON Oracle integration for holder verification
  - Winner payout processing
- Contract testing and auditing
- Testnet deployment and validation
- Mainnet deployment on Base

### Milestone 6.2: Oracle & Enhanced Features
- **Status**: ✅ Complete
- CLANKTON Oracle integration for real-time holder verification
- Multi-wallet support for CLANKTON balance checking
- Enhanced round management with onchain verification

### Milestone 6.4: Input & Word Wheel Performance Audit
- **Status**: ✅ Complete
- **Goal**: Make the main guessing experience feel instant and "buttery smooth" on every device

#### 6.4.1 - 6.4.2: Responsive Input (Previously Completed)
- **useTransition Integration**: Separates urgent input updates from low-priority wheel updates
- **Split State Architecture**:
  - `currentWord` → Used by input boxes (urgent, high priority)
  - `wheelCurrentGuess` → Used by wheel (deferred, low priority)
- **Execution Flow**:
  1. User types
  2. Input boxes render immediately (high priority)
  3. Browser paints input
  4. Wheel updates as transition (low priority)

#### 6.4.3: Performance Audit & Optimization
- **Memoized GuessSlot Component** (`components/LetterBoxes.tsx`):
  - Individual letter boxes wrapped in `React.memo`
  - Each slot only re-renders when its own props change
  - Eliminates "gray then black" flicker on first input box
  - Minimal prop surface: `letter`, `index`, `visualState`, `showReadyGlow`, `isLockedState`, `cursorType`
  - Visual state computed once per render, not per-slot
- **Performance Debugging Tools** (`src/lib/perf-debug.ts`):
  - Enable via `NEXT_PUBLIC_PERF_DEBUG=true`
  - `markKeydown()` / `markInputPainted()` for input timing
  - `logWheelAnimationStart()` / `logWheelAnimationEnd()` for wheel timing
  - Measures keydown-to-paint and keydown-to-wheel-animation times
  - `ExtremeJumpTests` for testing A↔Z wheel rotations
- **Wheel Component Optimizations** (`components/Wheel.tsx`):
  - Console.log statements gated behind `devLog()` utility
  - Performance logs use `perfLog()` (only when PERF_DEBUG enabled)
  - Animation timing logged for debugging
- **Tap/Focus Behavior Rules** (Preserved):
  - Empty row: Tapping any box focuses first box
  - Partial/full row: Tapping does nothing
  - Error/red state: Tapping does nothing
  - Locked states (SUBMITTING, OUT_OF_GUESSES, RESULT_CORRECT): All interaction blocked
- **Dev Mode Wheel Start Index** (Verified):
  - Production: Stable per-day-per-user from database
  - Dev mode: Fresh random on every page load for testing

#### Performance Metrics
- Input boxes re-render only affected slot (not all 5)
- Wheel animation capped at 100-250ms regardless of distance
- Virtual scrolling renders ~100 words instead of 4,439
- Binary search O(log n) for alphabetical positioning

#### Environment Variables
```bash
# Enable performance debugging logs
NEXT_PUBLIC_PERF_DEBUG=true

# Slow down wheel animations 3x for debugging
NEXT_PUBLIC_WHEEL_ANIMATION_DEBUG_SLOW=true
```

#### 6.4.4: Unified Result Banner System
- **ResultBanner Component** (`components/ResultBanner.tsx`):
  - Three variants: `error`, `warning`, `success`
  - Consistent layout: All banners share identical padding, border radius, typography
  - Theme-appropriate colors:
    - Error (red): Incorrect guesses, validation failures
    - Warning (amber): Already guessed words, "Not a valid word"
    - Success (green): Winner announcements
  - Icon handling:
    - Error: Red X icon (no emoji)
    - Warning: Amber warning triangle icon (no emoji)
    - Success: 🎉 emoji allowed
  - Accessibility: Uses `role="status"` and `aria-live="polite"`
  - **Milestone 6.7.1**: Added `faded` prop for gray/semi-transparent state
- **Banner Messages**:
  - Incorrect: "Incorrect! WORD is not the secret word."
  - Already guessed: "Already guessed this round." (warning)
  - Not a valid word: "Not a valid word" (warning)
  - Winner: "Correct! You found the word \"[WORD]\" and won this round!"

#### 6.7.1: Incorrect Guess Banner Flow + Input Reset
- **Goal**: Improve UX after incorrect guesses with timed state transitions
- **Incorrect State Machine** (`pages/index.tsx`):
  - `type IncorrectState = 'none' | 'active' | 'faded' | 'fading_out'`
  - `none`: No incorrect banner visible
  - `active`: Bright red error, input locked visually
  - `faded`: Softer gray banner showing context, input ready again
  - `fading_out`: Gray banner fading to transparent before dismissal
- **Timing** (Milestone 7.x refinements):
  - `INCORRECT_ACTIVE_DURATION_MS = 1500` (1.5s red state)
  - Red-to-gray transition: 1s (CSS transition on colors)
  - `INCORRECT_FADED_DURATION_MS = 1500` (1.5s gray state)
  - `INCORRECT_FADEOUT_DURATION_MS = 1000` (1s opacity fade out)
- **Color Transitions** (`components/ResultBanner.tsx`):
  - Smooth CSS transitions: `border-color 1000ms, background-color 1000ms, color 1000ms`
  - Faded state changes colors from red to gray via `faded` prop
  - Opacity transition for fade out: `opacity 1000ms ease-out`
- **Banner Behavior**:
  - `active`: Red banner with "Incorrect! WORD is not the secret word."
  - `faded`: Gray banner (opacity 0.8) with same message
  - `fading_out`: Gray banner fading to opacity 0
  - Message uses `lastSubmittedGuess` to persist word context
  - Clears `result` on dismiss to prevent banner reverting to red
- **Input Box Behavior**:
  - `active`: Red borders, empty, visually locked (`boxResultState = 'wrong'`)
  - `faded`: Normal neutral state (`boxResultState = 'typing'`), ready for input
- **Out of Guesses Handling**:
  - If no guesses remain after incorrect guess, skip `faded` entirely
  - Clear `incorrectState` to `'none'` and show "No guesses left today" banner
  - Input boxes remain locked/disabled
- **Timer Management**:
  - `incorrectTimerRef` tracks the active→faded timeout
  - `fadedDismissTimerRef` tracks the faded→fading_out timeout
  - `fadeoutTimerRef` tracks the fading_out→none timeout
  - Cleanup on component unmount (`useEffect` with cleanup function)
  - Cancel timer when user starts typing (`handleLettersChange`, `handleLetter`, `handleBackspace`)
  - Multiple incorrect guesses in a row work correctly (timer reset on each)
- **Files Changed**:
  - `components/ResultBanner.tsx`: Added `faded` prop, color transitions, updated styling
  - `pages/index.tsx`: Added state machine, timer logic, updated handlers

#### 6.4.5: Wheel Jump UX - Uniform Perceived Speed
- **Problem**: Large letter jumps (e.g., D→R) felt slower than small jumps (D→E) even with capped duration, because the wheel visibly scrolled through many rows.
- **Solution**: Two-mode animation based on row distance:
  - **Small Jumps** (≤10 rows): Smooth scroll animation with fixed 150ms duration
  - **Large Jumps** (>10 rows): "Teleport + Settle" approach:
    1. Instantly snap to 3 rows before target (no visible scroll)
    2. Animate the final 3 rows with same 150ms duration
    3. User never sees long "train ride" scroll - just quick snap + small settle
- **Configuration** (`components/Wheel.tsx`):
  - `JUMP_THRESHOLD = 10` - rows threshold for large jump detection
  - `SETTLE_ROWS = 3` - rows to animate after teleport
  - `ANIMATION_DURATION_UNIFORM = 150` - fixed duration for all visible animations
- **Reduced Motion Support**: If `prefers-reduced-motion: reduce` is set, all animations snap instantly
- **Result**: Typing "ABOUT" (small jump) and "READY" (large jump) now feel equally fast and snappy

### Milestone 6.5: Unified Guess Bar UX
- **Status**: ✅ Complete
- **Goal**: Create a single-line, intuitive, fully transparent guess-status bar

#### Overview
The unified guess bar shows total guesses left and all sources at a glance:
- **Left side**: "X guesses left today" (total remaining)
- **Right side**: Source breakdown (e.g., "1 free · +2 CLANKTON · +1 share · +3 paid")

#### Source Order (Consistent)
1. **Free** - Base daily allocation (always 1)
2. **CLANKTON** - Holder bonus (2-3 depending on market cap, only if holder)
3. **Share** - Share bonus (1, only after sharing)
4. **Paid** - Purchased packs (only if user has bought packs)

#### Depletion Visualization
- **Active sources**: Normal text with source-specific colors
  - Free: Default text color
  - CLANKTON: Purple (#7c3aed)
  - Share: Blue (#2563eb)
  - Paid: Blue (#2563eb)
- **Consumed sources**: Faded opacity (40%) with strikethrough

#### Source-Level State Tracking
The system now tracks usage per source:
```typescript
interface GuessSourceState {
  totalRemaining: number;
  free: { total: number; used: number; remaining: number; };
  clankton: { total: number; used: number; remaining: number; isHolder: boolean; };
  share: { total: number; used: number; remaining: number; hasSharedToday: boolean; canClaimBonus: boolean; };
  paid: { total: number; used: number; remaining: number; packsPurchased: number; maxPacksPerDay: number; canBuyMore: boolean; };
}
```

#### Consumption Order
When guesses are used, they are consumed in this order:
1. Free (base) guesses first
2. CLANKTON bonus guesses second
3. Share bonus guesses third
4. Paid guesses last

#### Files Modified
- `src/types/index.ts` - Added `GuessSourceState` interface
- `src/lib/daily-limits.ts` - Added `getGuessSourceState()` function
- `pages/api/user-state.ts` - Added `sourceState` to API response
- `components/GuessBar.tsx` - New unified guess bar component
- `components/UserState.tsx` - Updated to use GuessBar
- `src/contexts/DevPersonaContext.tsx` - Added sourceState to personas

#### Dev Mode Testing
The dev persona switcher now includes sourceState overrides for testing:
- **New Non-Holder**: 1 free, nothing used
- **Engaged Non-Holder**: Free used, share available
- **Non-Holder Out of Guesses**: All sources depleted
- **CLANKTON Holder (Low/High Tier)**: With holder bonuses
- **Maxed-Out Buyer**: All sources used including 9 paid guesses

### Milestone 6.6: Push Notifications & Bug Fixes
- **Status**: ✅ Complete
- **Goal**: Enable push notifications and fix critical duplicate guess bug

#### Farcaster Manifest
Created `public/.well-known/farcaster.json` for mini app configuration:
- Frame metadata (name, icon, splash screen)
- Neynar webhook URL for notification token management
- Enables discovery and installation from Farcaster

#### Mini App Add Prompt
Updated `components/FirstTimeOverlay.tsx` to prompt users to add the mini app:
- Uses `sdk.actions.addFrame()` from `@farcaster/miniapp-sdk`
- Primary CTA: "Add to Farcaster"
- Secondary option: "Skip for now"
- Auto-dismisses on success with haptic feedback
- Footer note: "Adding enables notifications for new rounds"

#### Duplicate Guess Bug Fix
**Critical bug in `src/lib/daily-limits.ts`:**
- **Problem**: `submitGuessWithDailyLimits()` decremented credits BEFORE calling `submitGuess()`
- **Impact**: Duplicate guesses (`already_guessed_word`) incorrectly consumed free/paid credits
- **Solution**: Restructured to validate FIRST, only consume credit if result is `correct` or `incorrect`
- **Protected statuses**: `already_guessed_word`, `invalid_word`, `round_closed` no longer consume credits

**Test coverage added** (`src/__tests__/daily-limits.test.ts`):
- Free guess credit protection for duplicates
- Paid guess credit protection for duplicates
- Invalid word credit protection
- Cross-user duplicate handling
- Mixed valid/invalid/duplicate sequence testing

#### Banner UI Updates
**Incorrect Guess Banner** (`pages/index.tsx`):
- New copy: "Incorrect! **WORD** is not the secret word."
- Word displayed in bold red (inherits banner text color)
- Removed X icon (clean text-only design)
- No guess count shown

**Already Guessed Banner**:
- Changed from yellow `warning` variant to red `error` variant
- Simplified message: "Already guessed this round"
- Matches client-side validation error styling

#### Files Modified
- `public/.well-known/farcaster.json` - New Farcaster manifest
- `components/FirstTimeOverlay.tsx` - Mini app add prompt
- `src/lib/daily-limits.ts` - Credit consumption bug fix
- `pages/index.tsx` - Banner copy and styling updates
- `components/ResultBanner.tsx` - Message prop now accepts `React.ReactNode`
- `src/__tests__/daily-limits.test.ts` - Duplicate guess protection tests
- `src/__tests__/input-state.test.ts` - New input state machine tests

### Milestone 7.x: UI/UX Refinements
- **Status**: ✅ Complete
- **Goal**: Polish user interface with improved transitions, typography, and visual consistency

#### Archive Page Redesign (`pages/archive/index.tsx`)
- Restyled to match RoundArchiveModal design language
- Uses Söhne font family: `'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif`
- Replaced inline styles with Tailwind classes for maintainability
- StatChip components with pill-style badges matching modal stat chips
- Clean rounded-2xl cards and modern button styling
- Consistent color scheme (gray-50 background, white cards, green for ETH, blue for links)

#### GuessPurchaseModal Refinements (`components/GuessPurchaseModal.tsx`)
- Moved pricing state label before pack options for better visual hierarchy
- De-emphasized purchase limit indicator (text-xs text-gray-400)
- Added reassurance microcopy: "Purchases contribute to the prize pool"
- Changed CTA from "Buy pack(s)" to "Buy guesses"
- Pricing labels:
  - EARLY (0-849 guesses): "Early round pricing"
  - MID (850-1249 guesses): "Mid round pricing"
  - LATE (1250+ guesses): "Late round pricing"

#### Dev Mode Pricing Consistency (`pages/api/guess-pack-pricing.ts`)
- Fixed inconsistency between TopTicker and GuessPurchaseModal in dev mode
- Problem: Pricing API used separate seeded random (multiplier 7927) different from `getDevRoundStatus()`
- Solution: Pricing API now calls `getDevRoundStatus()` for cached random values
- Ensures consistent display values across all UI components in dev mode

#### Files Modified
- `pages/archive/index.tsx` - Complete redesign with Söhne font and Tailwind
- `components/GuessPurchaseModal.tsx` - UX refinements and copy updates
- `pages/api/guess-pack-pricing.ts` - Dev mode consistency fix
- `components/ResultBanner.tsx` - Color transition timing updates
- `pages/index.tsx` - Banner timing and state machine updates
- `locales/en.json` - Updated translations ("Buy guesses", "jackpotNote")

### Milestone 8.1: Rotating Share Copy Templates
- **Status**: ✅ Complete
- **Goal**: Add variety to share prompts with rotating copy templates for incorrect guesses

#### Share Templates (`src/lib/shareTemplates.ts`)
New module with 9 unique share copy templates:
```typescript
const SHARE_TEMPLATES = [
  "❌ {WORD} wasn't it...\n\n🎯 Think you know the word?\n💰 {JACKPOT} ETH up for grabs\n\n👉 letshaveaword.fun",
  "So close! {WORD} was wrong 😅\n\n🧠 Can you crack it?\n💸 {JACKPOT} ETH prize pool\n\n🎮 letshaveaword.fun",
  // ... 7 more templates
];
```

- Uses `{WORD}` and `{JACKPOT}` placeholders for dynamic content
- `getRandomTemplate()`: Returns random template from array
- `renderShareTemplate(template, word, jackpotEth)`: Replaces placeholders with actual values
- All templates include game URL and emojis for engagement

#### SharePromptModal Updates (`components/SharePromptModal.tsx`)
- Fetches current prize pool from `/api/round-state` on mount
- Uses `useMemo` for stable random template selection (consistent within modal session)
- Removed preview section for cleaner, simpler modal
- Simplified footer: "Share bonus can only be earned once per day"
- Template rendered with current word and prize pool on share action

#### Files Modified
- `src/lib/shareTemplates.ts` - New file with 9 share templates
- `components/SharePromptModal.tsx` - Rotating templates, removed preview
- `locales/en.json` - Updated footer text

### Milestone 9.5: Kill Switch & Dead Day Operational Controls
- **Status**: ✅ Complete
- **Goal**: Add operational controls for emergency situations and planned maintenance

#### Unified Admin Dashboard (`pages/admin/index.tsx`)
- Single page at `/admin` with tabbed interface
- Four tabs: Operations, Analytics, Round Archive, Economics
- URL query param navigation (`?tab=operations|analytics|archive|economics`)
- Persistent status strip showing operational state
- Keyboard shortcuts (1/2/3/4) for tab switching

#### Kill Switch
- **API**: `POST /api/admin/operational/kill-switch`
- Emergency stop for active rounds
- Cancels current round and prevents new rounds from starting
- Requires reason for audit trail
- Triggers automatic refund process for cancelled rounds

#### Dead Day Mode
- **API**: `POST /api/admin/operational/dead-day`
- Planned maintenance mode - no new rounds start
- Current round continues to completion
- Visual indicators in Operations tab

#### Refund System
- **API**: `GET/POST /api/admin/operational/refunds`
- **Cron**: `pages/api/cron/process-refunds.ts`
- Automatic refund processing for cancelled rounds
- Tracks refund status: pending → processing → sent/failed
- Per-user refund aggregation from pack purchases

#### Database Schema Updates
- `pack_purchases` table for tracking individual purchases
- `refunds` table for refund tracking (status, tx hash, amounts)
- `operational_events` table for audit logging
- Round status field: `active` | `resolved` | `cancelled`
- Migrations: `0009_kill_switch_dead_day.sql`

#### Files Created/Modified
- `pages/admin/index.tsx` - Unified tabbed admin dashboard
- `components/admin/OperationsSection.tsx` - Operations tab UI
- `components/admin/AnalyticsSection.tsx` - Analytics tab wrapper
- `components/admin/ArchiveSection.tsx` - Archive tab wrapper
- `pages/api/admin/operational/status.ts` - Status endpoint
- `pages/api/admin/operational/kill-switch.ts` - Kill switch endpoint
- `pages/api/admin/operational/dead-day.ts` - Dead day endpoint
- `pages/api/admin/operational/refunds.ts` - Refund management endpoint
- `pages/api/cron/process-refunds.ts` - Refund processing cron

### Milestone 9.6: Economics Dashboard Enhancements
- **Status**: ✅ Complete
- **Goal**: Make Economics tab more decision-oriented and comparable over time

#### Target Evaluation Layer
- Static target ranges defined in code (`ECONOMICS_TARGETS`)
- Key metrics with targets:
  - Paid participation: 8-25%
  - ETH per 100 guesses: 0.005-0.02
  - Rounds ending before 750: 20-60%
  - Packs before 750: 40-80%
  - Referrer attach rate: 20-60%
  - Median round length: 300-1200 guesses
- "Below/Within/Above target" badges on scorecard tiles
- Delta display showing distance from target range
- Target-aware guidance recommendations

#### Prize Pool Growth Curve Chart
- SVG chart showing cumulative pool ETH vs guess index
- X-axis: guess index (sampled at 0, 50, 100, 150, 200, 250, 300, 400, 500, 600, 750, 900, 1000, 1200, 1500)
- Y-axis: prize pool ETH
- Median line with P25-P75 shaded envelope
- 750 cutoff vertical annotation line
- Auto-interpretation of growth pattern (early-heavy, balanced, late-heavy)

#### Per-Round Economics Config Snapshots
- New `round_economics_config` table
- Stores per round: top-10 cutoff, pricing thresholds/prices, pool split params
- Config change detection for historical comparison
- Migration: `0010_economics_config_snapshots.sql`

#### Compare Mode
- Dropdown selector in UI
- Options:
  - "Last 10 vs Previous 10 rounds"
  - "Since config change" (when detected)
- Side-by-side comparison showing:
  - Paid participation
  - ETH per 100 guesses
  - Rounds ending before 750
- Delta indicators with positive/negative styling

#### Files Modified
- `pages/api/admin/analytics/economics.ts` - Enhanced API with targets, growth curve, comparison
- `components/admin/EconomicsSection.tsx` - Updated UI with all new sections
- `src/db/schema.ts` - Added `roundEconomicsConfig` table and types
- `migrations/0010_economics_config_snapshots.sql` - New migration

### Milestone 10: Provably Fair Onchain Commitment
- **Status**: ✅ Complete
- **Goal**: Enhance provable fairness with onchain commitment and public verification

#### Onchain Commitment
- Each round's answer hash written to JackpotManager smart contract on Base
- `startRoundWithCommitment(bytes32 commitHash)` called before round accepts guesses
- Commitment immutably recorded with blockchain timestamp
- New contract view functions: `getCommitHash(roundNumber)`, `hasOnChainCommitment(roundNumber)`
- Smart contract upgraded via UUPS proxy pattern
- Implementation: `0x9166977F2096524eb5704830EEd40900Be9c51ee`
- Proxy: `0xfcb0D07a5BB5f004A1580D5Ae903E33c4A79EdB5`

#### Public Verification Page (`/verify`)
- Anyone can verify any round's fairness at `/verify`
- Shows: committed hash (database), onchain commitment (Base), revealed word, salt
- Client-side SHA256(salt + word) computation and comparison
- Deep linking: `/verify?round=42` for specific rounds
- Educational content explaining commit-reveal cryptography
- Direct link to smart contract on BaseScan
- Söhne typography consistent with main app

#### Column-Level Encryption
- Round answers encrypted at rest using AES-256-GCM
- Key from `ANSWER_ENCRYPTION_KEY` environment variable (32-byte hex)
- Storage format: `iv:authTag:ciphertext` (hex-encoded)
- Plaintext answer NEVER stored in database
- Module: `src/lib/encryption.ts`

#### Cryptographic Randomness
- Word selection uses `crypto.randomInt()` instead of `Math.random()`
- Cryptographically secure, unpredictable answer selection
- Module: `src/lib/word-lists.ts`

#### Updated Announcer Templates
All announcement formats updated with new copy:
- **Round Started**: Shortened hash (first 10 + last 4 chars), verify link, "locked onchain"
- **Round Complete**: Verify link, "top 10 early guessers", cleaner format
- **Jackpot Milestones**:
  - 0.1/0.25/0.5 ETH: 🔥 "One secret word. One winner."
  - 1.0 ETH: 🚨 "is getting serious"
- **Guess Milestones**: Now at 1K, 2K, 3K, 4K (was 100, 500, 1K, 5K, 10K)
- **Referral Wins**: "Share your link. You can win even when your friends do"

#### Files Added/Modified
- `pages/verify.tsx` - Public verification page
- `pages/api/verify/round.ts` - Verification data API
- `src/lib/encryption.ts` - Column-level encryption module
- `src/lib/jackpot-contract.ts` - Onchain commitment functions
- `src/lib/rounds.ts` - Integration with onchain commitment
- `src/lib/word-lists.ts` - Cryptographic randomness
- `src/lib/announcer.ts` - Updated announcement templates
- `contracts/src/JackpotManager.sol` - Commitment storage and view functions

#### Environment Configuration
- `ANSWER_ENCRYPTION_KEY` - 32-byte hex key for answer encryption (required)
- `OPERATOR_PRIVATE_KEY` - For contract interactions (existing)

### Milestone 11: Production Hardening & Onchain Pack Purchases
- **Status**: ✅ Complete
- **Goal**: Production-harden game operations with onchain pack purchases, comprehensive error handling, and enhanced admin tooling

#### Onchain Pack Purchases
Users now sign wallet transactions that are verified onchain before packs are awarded:

**Files:**
- `pages/api/purchase-guess-pack.ts` - Main API endpoint
- `src/lib/pack-pricing.ts` - Dynamic pricing logic
- `src/lib/daily-limits.ts` - Daily purchase limits & state

**How It Works:**
1. Frontend initiates wallet transaction via wagmi
2. User signs transaction in their wallet
3. Frontend waits for confirmation, then calls `/api/purchase-guess-pack` with `txHash`
4. API verifies transaction onchain using `verifyPurchaseTransaction()`
5. Awards packs only after successful verification (prevents fraud)
6. Tracks purchase via `txHash` to prevent double-claiming

**Dynamic Pricing Phases:**
- **EARLY** (0-849 guesses): 0.0003 ETH per pack
- **MID** (850-1249 guesses): 0.00045 ETH per pack
- **LATE** (1250+ guesses): 0.0006 ETH per pack (capped)

**Database Schema:**
```sql
pack_purchases {
  id, roundId, fid, packCount,
  totalPriceEth, totalPriceWei, pricingPhase,
  totalGuessesAtPurchase,
  txHash (unique), createdAt
}
```

#### Rate Limiting & Spam Protection

**Files:**
- `src/lib/rateLimit.ts` - Core rate limiting logic
- Applied to guesses, purchases, and shares

**Configuration (Environment Variables):**
```
RATE_LIMIT_GUESS_BURST_REQUESTS=8
RATE_LIMIT_GUESS_BURST_WINDOW=10
RATE_LIMIT_GUESS_SUSTAINED_REQUESTS=30
RATE_LIMIT_GUESS_SUSTAINED_WINDOW=60
RATE_LIMIT_SHARE_REQUESTS=6
RATE_LIMIT_SHARE_WINDOW=60
RATE_LIMIT_PURCHASE_REQUESTS=4
RATE_LIMIT_PURCHASE_WINDOW=300
RATE_LIMIT_DUPLICATE_WINDOW=10
```

**How It Works:**
- **FID-first limiting**: Prioritizes user FID if available
- **Fallback to IP+UA hash**: If no FID, uses IP+UserAgent combo
- **Sliding window algorithm**: Using Redis sorted sets for atomic operations
- **Dual-window for guesses**: Burst (8/10s) + Sustained (30/60s) checks
- **Duplicate detection**: Prevents re-submission of same word within 10 seconds
- **Fail-open**: Returns allowed=true if Redis unavailable

#### Share Verification via Neynar API

**Files:**
- `pages/api/share-callback.ts` - Main endpoint
- `src/lib/farcaster.ts` - Neynar API integration

**How It Works:**
1. User clicks "Share to Farcaster" button
2. Opens composer with pre-filled text mentioning `letshaveaword.fun`
3. User posts the cast
4. Frontend calls `/api/share-callback` with FID after posting
5. API verifies cast exists on Farcaster via Neynar (last 10 minutes)
6. Only awards bonus if cast is verified
7. Prevents gaming by just opening composer without posting

#### CLANKTON Mid-Day Tier Upgrade

**Files:**
- `src/lib/clankton.ts` - Token balance and tier checking
- `src/lib/clankton-oracle.ts` - Market cap oracle
- `src/lib/daily-limits.ts` - Bonus allocation

**Tier Detection:**
- LOW tier: Market cap < $250K → 2 free guesses
- HIGH tier: Market cap >= $250K → 3 free guesses

**Mid-Day Upgrade:**
- If market cap crosses $250K during the day, holders get +1 guess immediately
- Not just applied at daily reset anymore
- `CLANKTON_MARKET_CAP_USD` environment variable for testing

#### Leaderboard Lock at 850 Guesses

**Files:**
- `src/lib/top10-lock.ts` - Lock threshold constants and round-specific logic
- `pages/api/round/top-guessers.ts` - Top-10 API
- `src/lib/guesses.ts` - Guess indexing

**How It Works:**
1. Each guess gets a `guessIndexInRound` (1-based counter)
2. Top-10 locked after guess #850 (was 750 for rounds 1-3)
3. Leaderboard only counts guesses 1-850
4. Guesses 851+ count for winning jackpot but not for Top-10 ranking
5. Prevents late-game clustering from skewing leaderboard

**Configuration:**
```typescript
// Historical thresholds (for archive accuracy)
LEGACY_TOP10_LOCK = 750           // Rounds 1-3
NEW_TOP10_LOCK = 850              // Round 4+
TOP10_LOCK_AFTER_GUESSES = 850    // Current default

// Use getTop10LockForRound(roundId) for round-specific threshold
```

#### Comprehensive Error Handling

**File:** `src/lib/appErrors.ts`

**Error Categories & Sample Codes:**

| Category | Codes |
|----------|-------|
| Network | NETWORK_UNAVAILABLE, SERVER_ERROR, REQUEST_TIMEOUT, RATE_LIMITED |
| Round State | ROUND_STATE_UNAVAILABLE, ROUND_STALE, ROUND_CLOSED, ROUND_NOT_ACTIVE |
| Pricing | USD_PRICE_UNAVAILABLE, COINGECKO_RATE_LIMITED, PRICING_UNAVAILABLE |
| User | USER_STATE_UNAVAILABLE, USER_QUALITY_BLOCKED, FARCASTER_CONTEXT_MISSING |
| Guess | WHEEL_UNAVAILABLE, GUESS_FAILED, OUT_OF_GUESSES, INVALID_WORD |
| Share | SHARE_FAILED, SHARE_ALREADY_CLAIMED |
| Purchase | PURCHASE_FAILED, PURCHASE_TX_REJECTED, PURCHASE_TX_TIMEOUT |
| Wallet | WALLET_READ_FAILED, WALLET_NOT_CONNECTED |
| Operational | GAME_PAUSED, GAME_BETWEEN_ROUNDS |

**Error Display Config:**
```typescript
{
  userTitle: string;           // User-facing title
  userBody?: string;           // Description
  primaryCtaLabel: string;     // Button text
  primaryCtaAction: ErrorCtaAction; // Action type
  bannerVariant: 'error'|'warning'|'info';
  autoRetry?: boolean;
  maxAutoRetries?: number;
}
```

#### Contract State Diagnostics

**File:** `pages/api/admin/operational/contract-state.ts`

**Diagnostics Data:**
```typescript
{
  network: 'mainnet' | 'sepolia',
  contractAddress: string,
  roundNumber: number,
  isActive: boolean,
  internalJackpot: string,
  actualBalance: string,
  hasMismatch: boolean,
  mismatchAmount: string,
  canResolve: boolean
}
```

**Operations:**
- **GET**: Fetch current state for both mainnet + Sepolia
- **POST**: `clear-sepolia-round` action (resolve to operator wallet)

#### Force Resolve Admin Button

**File:** `pages/api/admin/operational/force-resolve.ts`

**How It Works:**
1. Admin clicks "Force Resolve Round" button in Operations tab
2. API fetches active round
3. Submits correct answer as guess from special admin user (FID 9999999)
4. Triggers normal round resolution flow
5. Logs timestamp and admin FID for audit

#### Sepolia Round Simulation

**File:** `pages/api/admin/operational/simulate-round.ts`

**Simulation Config:**
```typescript
{
  answer?: string;       // Round answer (default: random)
  numGuesses: number;    // Wrong guesses to simulate (1-100)
  numUsers: number;      // Fake users (1-10)
  skipOnchain: boolean;  // Skip all onchain ops
  dryRun: boolean;       // Don't actually change state
}
```

**Features:**
- Independent of production state (bypasses active round check)
- Auto-resolves previous round if needed
- Auto-seeds jackpot if below minimum
- Handles contract state mismatch gracefully
- DB-only fallback if onchain fails

#### Production Safety Checks

Lessons learned from Sepolia testing:
- Always verify round is still active before resolution
- Check balance sufficiency before attempting withdrawal
- Implement retry logic with exponential backoff
- Log all contract state for diagnostics
- Have emergency manual override (clear-sepolia-round)

#### Bonus Guesses Tracking

**File:** `src/lib/daily-limits.ts`

**Allocation Order (consumed in sequence):**
1. **Base Free**: 1 guess (always)
2. **CLANKTON Bonus**: 2 or 3 guesses (if holder)
3. **Share Bonus**: 1 guess (if shared today)
4. **Paid Guesses**: 3 per pack (max 9 per day)

**Tracking Schema:**
```sql
dailyGuessState {
  freeAllocatedBase: 1
  freeAllocatedClankton: 0|2|3
  freeAllocatedShareBonus: 0|1
  freeUsed: int
  paidGuessCredits: int
  paidPacksPurchased: int (tracks daily purchases)
  hasSharedToday: boolean
}
```

**Source State Response:**
```typescript
{
  totalRemaining: number,
  free: { total, used, remaining },
  clankton: { total, used, remaining, isHolder },
  share: { total, used, remaining, hasSharedToday, canClaimBonus },
  paid: { total, used, remaining, packsPurchased, maxPacksPerDay, canBuyMore }
}
```

#### Environment Variables Added

| Variable | Purpose | Default |
|----------|---------|---------|
| `BASE_RPC_URL` | Mainnet RPC for purchase verification | https://mainnet.base.org |
| `BASE_SEPOLIA_RPC_URL` | Sepolia RPC for simulation | https://sepolia.base.org |
| `RATE_LIMIT_GUESS_*` | Guess rate limits | 8/10s burst, 30/60s sustained |
| `RATE_LIMIT_PURCHASE_*` | Purchase rate limits | 4 per 300s |
| `RATE_LIMIT_SHARE_*` | Share rate limits | 6 per 60s |
| `CLANKTON_MARKET_CAP_USD` | Override market cap for testing | (from oracle) |

#### Files Added/Modified

**New Files:**
- `src/lib/rateLimit.ts` - Rate limiting infrastructure
- `src/lib/appErrors.ts` - Comprehensive error system
- `pages/api/admin/operational/contract-state.ts` - Contract diagnostics
- `pages/api/admin/operational/force-resolve.ts` - Force resolve endpoint
- `pages/api/admin/operational/simulate-round.ts` - Sepolia simulation

**Modified Files:**
- `pages/api/purchase-guess-pack.ts` - Onchain verification
- `pages/api/share-callback.ts` - Neynar cast verification
- `src/lib/daily-limits.ts` - Source-level tracking, mid-day upgrade
- `src/lib/clankton.ts` - Tier upgrade logic
- `src/lib/guesses.ts` - Guess index tracking
- `components/admin/OperationsSection.tsx` - Force resolve, contract state UI

### Milestone 12: OG Hunter Prelaunch & Mini App Enhancements
- **Status**: ✅ Complete
- **Goal**: Prelaunch campaign system and enhanced Farcaster mini app integration

#### OG Hunter Campaign
- Prelaunch campaign at `/splash` where early users earn permanent badges
- Users add the mini app + share a cast to qualify
- 500 XP bonus for completing both actions
- "Verified" badge after webhook confirmation
- Database tables: `user_badges`, `og_hunter_cast_proofs`

#### Mini App Improvements
- Added `fc:miniapp` meta tag alongside `fc:frame` for better embed support
- Share flows use `sdk.actions.composeCast()` with `embeds` parameter
- Embeds auto-load in Farcaster clients
- External links use `sdk.actions.openUrl()` for proper in-app navigation

#### Admin Start Round Button
- Green "Start Round" card appears when no active round exists
- One-click round creation from admin dashboard
- Creates round with random word and onchain commitment

#### Environment Variables
- `NEXT_PUBLIC_PRELAUNCH_MODE` - Set to `1` for splash page, `0` for game

### Milestone 13: Security - Quick Auth Authentication
- **Status**: ✅ Complete
- **Goal**: Secure authentication using Farcaster Quick Auth to prevent FID spoofing attacks

#### The Problem
The previous authentication flow trusted `miniAppFid` from the Farcaster SDK context without verification. Since this is client-side data, anyone could spoof requests with arbitrary FIDs, allowing them to submit guesses as other users.

#### The Solution: Quick Auth
Quick Auth provides cryptographically signed JWT tokens that prove the user owns a Farcaster account.

**Client-side (`pages/index.tsx`):**
```typescript
import sdk, { quickAuth } from '@farcaster/miniapp-sdk';

// Get Quick Auth token (automatic, no user interaction)
const { token } = await quickAuth.getToken();

// Send with API requests
fetch('/api/guess', {
  body: JSON.stringify({ word, authToken: token })
});
```

**Server-side (`pages/api/guess.ts`):**
```typescript
import { createClient as createQuickAuthClient } from '@farcaster/quick-auth';

const quickAuthClient = createQuickAuthClient();

// Verify token and extract FID
const { authToken } = req.body;
const verifyResult = await quickAuthClient.verifyJwt({ token: authToken });
const fid = verifyResult.sub; // Verified FID from JWT
```

#### Security Enforcement
- Unverified `miniAppFid` requests are rejected with 401 error
- Only cryptographically verified JWTs can authenticate users
- Dev mode (`devFid`) still works for local testing
- Frame and signer UUID auth paths unchanged

#### Dependencies Added
- `@farcaster/quick-auth` - Server-side JWT verification

### Planned / Future Enhancements
- **Status**: Wishlist
- Domain acquisition (http://letshaveaword.fun)
- XP system v2 with progression paths
- Global leaderboards and rankings
- Additional language translations
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

The unified admin dashboard is accessible at `/admin` (web-only, not in mini app).

#### Authentication

- Uses **Neynar SIWN** (Sign In With Neynar)
- Only FIDs in `LHAW_ADMIN_USER_IDS` can access
- Session validated on every API call

#### Unified Dashboard (`/admin`)

The main admin interface consolidates all management functions into a single tabbed page:

- **URL**: `/admin` with query param navigation (`?tab=operations|analytics|archive|economics`)
- **Default tab**: Operations
- **Keyboard shortcuts**: Press 1/2/3/4 to switch tabs
- **Status strip**: Persistent header showing operational state (normal, kill switch, dead day)

#### Dashboard Tabs

1. **Operations** (`?tab=operations`) - Operational controls and status
   - Kill switch toggle with reason input
   - Dead day mode toggle
   - Real-time operational status display
   - Refund progress tracking for cancelled rounds
   - Audit log of operational events

2. **Analytics** (`?tab=analytics`) - Game metrics and user analytics
   - DAU/WAU tables
   - Free vs paid guess breakdown
   - Jackpot growth charts
   - Referral funnel metrics
   - Raw events log with expandable JSON

3. **Round Archive** (`?tab=archive`) - Historical round data
   - Statistics overview (total rounds, guesses, winners, jackpot distributed)
   - Paginated round table with click-to-detail
   - Winner info, payouts, guess distribution histogram
   - Sync controls and error monitoring

4. **Economics** (`?tab=economics`) - Game economics health monitoring
   - Health Overview Scorecard with target evaluation (paid participation, pool velocity, etc.)
   - Prize Pool Growth Curve chart (median with P25-P75 envelope)
   - Pack Pricing & Purchase Behavior analysis
   - 750 Cutoff Diagnostics
   - Pool Split & Referral Analysis
   - Compare Mode for period comparisons
   - Guidance Recommendations based on targets

#### Operational Controls (Milestone 9.5)

**Kill Switch** - Emergency stop for critical issues:
- Immediately cancels the active round
- Prevents new rounds from starting
- Triggers automatic refund process for pack purchases
- Requires reason for audit trail
- API: `POST /api/admin/operational/kill-switch`

**Dead Day Mode** - Planned maintenance:
- Current round continues to completion
- No new rounds start after current round ends
- Use for scheduled maintenance or breaks
- API: `POST /api/admin/operational/dead-day`

**Refund System**:
- Automatic refunds for cancelled rounds
- Status tracking: pending → processing → sent/failed
- Cron job processes refunds in batches
- API: `GET/POST /api/admin/operational/refunds`

#### Economics Dashboard (Milestone 9.6)

**Target Evaluation**:
- Static target ranges defined in code
- Metrics evaluated against targets: below/within/above
- Targets include: paid participation (8-25%), ETH/100 guesses (0.005-0.02), rounds ending before 750 (20-60%), referrer attach rate (20-60%)

**Growth Curve Chart**:
- X-axis: guess index (0-1500)
- Y-axis: prize pool ETH
- Shows median, P25, P75 percentile bands
- 750 cutoff line annotated
- Auto-generated interpretation

**Compare Mode**:
- "Last 10 vs Previous 10 rounds"
- "Since config change" (when detected)
- Side-by-side metrics comparison
- Delta indicators for improvements/regressions

**Config Snapshots**:
- `round_economics_config` table stores per-round config
- Automatically detects config changes
- Enables before/after comparison

#### API Endpoints

**Admin Status:**
- `GET /api/admin/me` - Check admin status

**Operational:**
- `GET /api/admin/operational/status` - Current operational state
- `POST /api/admin/operational/kill-switch` - Toggle kill switch
- `POST /api/admin/operational/dead-day` - Toggle dead day mode
- `GET/POST /api/admin/operational/refunds` - Refund management

**Analytics:**
- `GET /api/admin/analytics/dau` - DAU data
- `GET /api/admin/analytics/wau` - WAU data
- `GET /api/admin/analytics/free-paid` - Free/paid ratio
- `GET /api/admin/analytics/jackpot` - Jackpot growth
- `GET /api/admin/analytics/referral` - Referral funnel
- `GET /api/admin/analytics/events` - Raw events (paginated)
- `GET /api/admin/analytics/economics` - Economics metrics with targets

**Archive:**
- `POST /api/admin/archive/sync` - Sync rounds to archive
- `GET /api/admin/archive/errors` - View archive errors
- `GET /api/admin/archive/debug/:roundNumber` - Debug specific round

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

**Requirement:** Neynar User Score ≥ 0.55

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
  "message": "Your Farcaster reputation score (0.45) is below the minimum required (0.55)...",
  "score": 0.45,
  "minRequired": 0.55,
  "helpUrl": "https://docs.neynar.com/docs/user-scores"
}
```

**Configuration:**
- Enable: `USER_QUALITY_GATING_ENABLED=true`
- Threshold: 0.55 (configurable in `MIN_USER_SCORE` constant)

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

**Economic Rules Verified (January 2026):**
```typescript
const ECONOMIC_RULES = {
  GUESS_PRICE_ETH: 0.0003,      // Base price per paid guess pack
  WINNER_SHARE: 0.8,            // 80% of jackpot to winner
  TOP_GUESSERS_SHARE: 0.1,      // 10% to top 10 early guessers
  SEED_SHARE: 0.05,             // 5% to next round seed
  REFERRER_SHARE: 0.05,         // 5% to referrer (if exists)
  SEED_CAP_ETH: 0.03,           // 0.03 ETH seed cap (overflow → creator)
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

## Daily Guess Flow

### Overview

The Daily Guess Flow spec defines how players interact with the game throughout a day, including when and how modals are shown for share bonuses and guess pack purchases.

### Daily Counters & State

Per FID, per calendar day (UTC):

| Counter | Description |
|---------|-------------|
| `baseFreeGuesses` | 1 per day |
| `clanktonBonusGuesses` | 2 or 3 (market cap tier dependent) |
| `shareBonusGuesses` | 1 (Farcaster share, once per day) |
| `packsPurchasedToday` | 0-3, each pack = 3 guesses |
| `totalGuessCapToday` | baseFree + clanktonBonus + shareBonus + 3 * packsPurchased |

**State Flags:**
- `hasUsedShareBonusToday` - Whether share bonus already claimed
- `hasSeenShareModalThisSession` - Session-level tracking to avoid repeat modals
- `hasSeenPackModalThisSession` - Session-level tracking for pack modal
- `guessesRemainingToday` - Current remaining guesses

### High-Level Daily Flow

```
DAY START
  ↓
User lands on game
  ↓
Initialize session:
  - Detect FID
  - Detect CLANKTON tier
  - Load counters + flags
  ↓
LOOP: While user has guessesRemainingToday > 0
  1. User enters a word and hits GUESS
  2. Validate + submit guess
  3. Update guessesRemainingToday--
  4. Resolve feedback (colors, stats, etc.)
  5. Decide which (if any) modal to show
  6. User either leaves or continues to next guess
END LOOP
  ↓
If guessesRemainingToday == 0:
  - Offer last-chance share and/or packs
  - If declined / exhausted → "You're out of guesses" state
```

### Modal Decision Logic

The `useModalDecision` hook (`src/hooks/useModalDecision.ts`) implements this decision tree:

```typescript
function decideModal(params: ModalDecisionParams): ModalDecision {
  const {
    guessesRemaining,
    hasUsedShareBonusToday,
    packsPurchasedToday,
    maxPacksPerDay,
  } = params;

  // 1. Still have guesses → no paywall, maybe show share once
  if (guessesRemaining > 0) {
    if (!hasUsedShareBonusToday && !hasSeenShareModalThisSession) {
      return 'share';
    }
    return 'none';
  }

  // 2. Out of guesses: prioritize free share
  if (!hasUsedShareBonusToday && !hasSeenShareModalThisSession) {
    return 'share';
  }

  // 3. Share exhausted or declined: offer packs if available
  if (packsPurchasedToday < maxPacksPerDay && !hasSeenPackModalThisSession) {
    return 'pack';
  }

  // 4. Hard stop
  return 'out_of_guesses';
}
```

### Modal Types

| Decision | Modal Shown | Description |
|----------|-------------|-------------|
| `none` | No modal | User has guesses, can continue playing |
| `share` | SharePromptModal | Offer to share for +1 free guess |
| `pack` | GuessPurchaseModal | Offer to buy guess packs |
| `out_of_guesses` | AnotherGuessModal | Show "out of guesses" state |

### Session State Tracking

Session-level flags prevent modals from appearing repeatedly within the same browsing session:

- **`hasSeenShareModalThisSession`**: Set to `true` when SharePromptModal closes (regardless of whether user shared)
- **`hasSeenPackModalThisSession`**: Set to `true` when GuessPurchaseModal closes (regardless of purchase)

These flags reset on:
- Page refresh
- New browser session
- Daily reset (11:00 UTC)

### User Type Flows

#### Non-CLANKTON Holder

**Daily caps:**
- Base free guesses: 1
- CLANKTON bonus: 0
- Share bonus: 1
- Packs available: up to 3 (9 guesses)

**Example Flow - "Guess → Share → Bonus Guess → Quit":**
1. Start → 1 free guess
2. Guess #1 → Share modal appears
3. User shares → `hasUsedShareBonusToday = true`, `guessesRemaining = 1`
4. Guess #2 (share bonus) → `guessesRemaining = 0`
5. Share bonus used → Pack modal appears
6. User declines → Out-of-guesses state

#### CLANKTON Holder (LOW Tier: +2, HIGH Tier: +3)

**Daily caps (LOW example):**
- Base free guesses: 1
- CLANKTON bonus: 2 → total free = 3
- Share bonus: 1
- Packs: up to 3

**Recommended timing:**
- Show share modal when `guessesRemaining == 1` (creates urgency)
- Pack modal only when completely out of guesses

### Implementation

**Hook Location:** `src/hooks/useModalDecision.ts`

**Integration in `pages/index.tsx`:**

```typescript
const {
  decideModal,
  markShareModalSeen,
  markPackModalSeen,
} = useModalDecision();

// After guess resolved:
const decision = decideModal({
  guessesRemaining: stateData.totalGuessesRemaining,
  hasUsedShareBonusToday: stateData.hasSharedToday,
  packsPurchasedToday: stateData.paidPacksPurchased,
  maxPacksPerDay: stateData.maxPaidPacksPerDay,
});

// Show appropriate modal based on decision
switch (decision) {
  case 'share':
    setShowShareModal(true);
    break;
  case 'pack':
    setShowGuessPurchaseModal(true);
    break;
  case 'out_of_guesses':
    setShowAnotherGuessModal(true);
    break;
  case 'none':
  default:
    // No modal needed
    break;
}
```

**Modal Close Handlers:**

```typescript
// SharePromptModal close
const handleShareModalClose = () => {
  setShowShareModal(false);
  markShareModalSeen();

  if (!hasGuessesLeft) {
    // User closed without sharing - offer packs
    if (paidPacksPurchased < maxPaidPacksPerDay) {
      setShowGuessPurchaseModal(true);
    } else {
      setShowAnotherGuessModal(true);
    }
  }
};

// GuessPurchaseModal close
onClose={() => {
  setShowGuessPurchaseModal(false);
  markPackModalSeen();

  if (!hasGuessesLeft) {
    setShowAnotherGuessModal(true);
  }
}}
```

### API Requirements

The `/api/user-state` endpoint must return:

```json
{
  "totalGuessesRemaining": 3,
  "hasSharedToday": false,
  "paidPacksPurchased": 0,
  "maxPaidPacksPerDay": 3
}
```

These fields are used by the modal decision logic to determine which modal to show.

---

## Guess Packs

### Overview

Guess Packs are the primary monetization mechanism, allowing players to purchase additional guesses beyond their daily free allocation.

### Pack Definitions

| Pack Size | Price (ETH) | Guesses | Daily Limit |
|-----------|-------------|---------|-------------|
| 1 Pack    | 0.0003+     | 3       | Unlimited (volume pricing) |
| 2 Packs   | 0.0006+     | 6       | Unlimited (volume pricing) |
| 3 Packs   | 0.0009+     | 9       | Unlimited (volume pricing) |

**Key Rules:**
- Packs contain **3 guesses each** (fixed, not configurable per-pack)
- **Unlimited packs** with volume-based pricing tiers (1×, 1.5×, 2× multipliers)
- Price: **0.0003 ETH per pack** (~$1 at current prices)
- Pack credits **do not expire** - carry over between rounds
- Pack credits are used **after** free guesses are exhausted

### Pricing Configuration

Defined in `config/economy.ts`:

```typescript
export const GUESS_PACK_SIZE = 3;           // Guesses per pack
export const MAX_PACKS_PER_DAY = 3;          // Daily purchase limit
export const GUESS_PACK_PRICE_ETH = '0.0003'; // Price per pack

export function getPackPricingInfo() {
  return {
    packSize: GUESS_PACK_SIZE,
    maxPacksPerDay: MAX_PACKS_PER_DAY,
    pricePerPackEth: GUESS_PACK_PRICE_ETH,
    pricePerGuessEth: (parseFloat(GUESS_PACK_PRICE_ETH) / GUESS_PACK_SIZE).toFixed(6),
  };
}
```

### How Guesses Decrement

1. **Free guesses first**: Base (1) → CLANKTON bonus (2-3) → Share bonus (1)
2. **Then paid credits**: From `daily_guess_state.paid_guess_credits`
3. **Track separately**: `free_spent` vs `paid_spent` columns

```typescript
// In daily-limits.ts
export function decrementGuess(dailyState: DailyGuessState): 'free' | 'paid' {
  const freeRemaining = getFreeGuessesRemaining(dailyState);

  if (freeRemaining > 0) {
    // Decrement free guess
    await db.update(dailyGuessState)
      .set({ freeSpent: dailyState.freeSpent + 1 })
      .where(eq(dailyGuessState.id, dailyState.id));
    return 'free';
  } else if (dailyState.paidGuessCredits > 0) {
    // Decrement paid guess
    await db.update(dailyGuessState)
      .set({
        paidGuessCredits: dailyState.paidGuessCredits - 1,
        paidSpent: dailyState.paidSpent + 1,
      })
      .where(eq(dailyGuessState.id, dailyState.id));
    return 'paid';
  }

  throw new Error('No guesses remaining');
}
```

### Tracking & Rate-Limiting

**Database Tracking:**
```sql
-- Daily state per user
SELECT * FROM daily_guess_state WHERE fid = 12345 AND date = CURRENT_DATE;

-- Fields:
-- paid_packs_purchased: Number of packs bought today
-- paid_guess_credits: Remaining paid guesses
-- paid_spent: Paid guesses used today
```

**API Validation:**
```typescript
// In purchase-guess-pack.ts
if (dailyState.paidPacksPurchased >= MAX_PACKS_PER_DAY) {
  return res.status(400).json({
    error: 'Daily pack limit reached',
    packsRemaining: 0,
  });
}
```

### API Endpoints

#### `GET /api/guess-pack-pricing`
Returns current pack pricing info.

**Response:**
```json
{
  "packSize": 3,
  "maxPacksPerDay": 3,
  "pricePerPackEth": "0.0003",
  "pricePerGuessEth": "0.0001"
}
```

#### `POST /api/purchase-guess-pack`
Process pack purchase.

**Request:**
```json
{
  "fid": 12345,
  "packCount": 2,
  "txHash": "0x..." // Optional: onchain transaction hash
}
```

**Response:**
```json
{
  "success": true,
  "packsPurchased": 2,
  "guessesAdded": 6,
  "totalPaidCredits": 9,
  "packsRemainingToday": 1
}
```

### UI Components

**GuessPurchaseModal** (`components/GuessPurchaseModal.tsx`):
- Pack quantity selector (1, 2, or 3 packs)
- Dynamic price calculation
- Daily limit indicator ("2 of 3 packs purchased today")
- Purchase button with loading state

**AnotherGuessModal** (`components/AnotherGuessModal.tsx`):
- "Want another guess?" popup after wrong guess
- Random interjection from 25 phrases
- Two CTAs: "Share for Free Guess" and "Buy Pack"

---

## Share-for-Free-Guess

### Overview

Players can earn +1 free guess per day by sharing to Farcaster. This is the primary organic growth mechanism.

### Eligibility Rules

1. **Once per day**: Only one share bonus per 24-hour period
2. **Farcaster only**: X/Twitter shares do not qualify for free guess
3. **Must complete share**: Bonus awarded after Farcaster composer action
4. **Tracked in database**: `daily_guess_state.free_allocated_share_bonus`

### Flow

1. User submits a guess (correct or incorrect)
2. After 2-second delay, `SharePromptModal` appears
3. User clicks "Share to Farcaster"
4. Farcaster composer opens with pre-filled text
5. After share, `/api/share-callback` is called
6. If eligible, +1 free guess awarded
7. User state updated to show new allocation

### Anti-Abuse Model

**Rate Limiting:**
- One share bonus per calendar day (UTC)
- Tracked via `free_allocated_share_bonus` column
- Cannot be "stacked" across days

**Verification:**
- Share callback requires valid FID
- Database check prevents duplicate awards
- Analytics logged for monitoring

**Share Text:**
```typescript
const shareText = `I just made a guess on Let's Have A Word! 🎯

The jackpot is now ${prizePoolEth} ETH (~$${prizePoolUsd})

Play now: https://lets-have-a-word.vercel.app?ref=${fid}`;
```

### API Implementation

```typescript
// share-callback.ts
export default async function handler(req, res) {
  const { fid, castHash } = req.body;

  // Get daily state
  const dailyState = await getOrCreateDailyState(fid);

  // Check if already shared today
  if (dailyState.freeAllocatedShareBonus > 0) {
    return res.json({
      ok: true,
      message: 'Share bonus already claimed today',
      alreadyClaimed: true,
    });
  }

  // Award share bonus
  await db.update(dailyGuessState)
    .set({ freeAllocatedShareBonus: 1 })
    .where(eq(dailyGuessState.id, dailyState.id));

  // Log analytics
  logAnalyticsEvent('SHARE_SUCCESS', {
    userId: fid.toString(),
    data: { castHash, bonusAwarded: true },
  });

  return res.json({
    ok: true,
    message: 'Share bonus awarded!',
    bonusAwarded: true,
  });
}
```

### User State Response

```json
{
  "freeAllocations": {
    "base": 1,
    "clankton": 2,
    "shareBonus": 1  // 0 if not yet shared
  },
  "hasSharedToday": true  // Milestone 6.3 field
}
```

---

## CLANKTON Holder Bonus

### Overview

CLANKTON token holders receive bonus daily guesses as a loyalty reward. The bonus amount scales with the token's market cap.

### Market Cap Tiers

| Market Cap       | Bonus Guesses | Min Balance |
|------------------|---------------|-------------|
| < $250,000       | +2/day        | 100M tokens |
| >= $250,000      | +3/day        | 100M tokens |

**Token Contract:** `0x1D008f50FB828eF9DEBBBEaE1b71fFFE929bf317` (Base)

### Oracle Freshness Rules

The CLANKTON oracle verifies holder status with specific freshness requirements:

1. **Check Frequency**: Balance checked on first action of day
2. **Cache Duration**: 24 hours (same as daily reset)
3. **Fallback**: If oracle unavailable, use last known status
4. **Refresh Trigger**: Wallet reconnection forces fresh check

### Implementation

**Balance Check** (`src/lib/clankton.ts`):
```typescript
const CLANKTON_MIN_BALANCE = 100_000_000n; // 100M tokens

export async function hasClanktonBonus(walletAddress: string): Promise<boolean> {
  try {
    const balance = await publicClient.readContract({
      address: CLANKTON_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [walletAddress],
    });

    return balance >= CLANKTON_MIN_BALANCE;
  } catch (error) {
    console.error('[clankton] Balance check failed:', error);
    return false; // Conservative fallback
  }
}
```

**Market Cap Check** (via CoinGecko or DEX):
```typescript
export async function getClanktonBonusTier(): Promise<number> {
  const marketCap = await getClanktonMarketCap();
  return marketCap >= 250_000 ? 3 : 2;
}
```

### Fallback Behavior

1. **Oracle Down**: Use database-cached `clanktonBonusActive` status
2. **Wallet Not Connected**: No CLANKTON bonus (cannot verify)
3. **API Error**: Log error, continue with conservative (no bonus) default
4. **Dev Mode**: Uses real wallet check when wallet connected

### User State Fields

```json
{
  "clanktonBonusActive": true,
  "isClanktonHolder": true,
  "freeAllocations": {
    "base": 1,
    "clankton": 2,  // or 3 at higher market cap
    "shareBonus": 0
  }
}
```

---

## Referral System

### Overview

Players earn 10% of their referrals' jackpot winnings. This creates viral growth through aligned incentives.

### 5% Jackpot Reward

When a referred player wins the jackpot:
- **80%** goes to the winner
- **10%** goes to top 10 early guessers (weighted by rank)
- **5%** goes to next round seed (capped at 0.03 ETH)
- **5%** goes to the referrer

**Example (1.0 ETH jackpot with referrer):**
- Winner receives: 0.80 ETH
- Top 10 share: 0.10 ETH (weighted distribution)
- Next round seed: 0.03 ETH (capped), 0.02 ETH overflow → creator
- Referrer receives: 0.05 ETH

### Tracking

**Referral Link Format:**
```
https://lets-have-a-word.vercel.app?ref={FID}
```

**Database Storage:**
```sql
-- users table
referrer_fid INTEGER REFERENCES users(fid)
```

**When Tracked:**
- New user's first visit with `?ref=` parameter
- Stored permanently (referrer never changes)
- Logged via `REFERRAL_JOIN` analytics event

### Limits

- **One referrer per user**: Cannot change referrer
- **Self-referral blocked**: Cannot refer yourself
- **No chain limits**: Referrers can refer unlimited users
- **No expiration**: Referral relationship is permanent

### Fraud Protection

1. **User Quality Gating**: Only users with Neynar score >= 0.55 can play
2. **Wallet Clustering**: Simulation detects shared wallets
3. **Rapid Win Detection**: Flags statistically improbable wins
4. **Analytics Monitoring**: All referral events logged for review

### Referral UI

**ReferralSheet** (`components/ReferralSheet.tsx`):
- Referral link display with copy button
- Auto-copy on modal open (optional)
- Animated ETH earned counter
- Share to Farcaster/X buttons
- Total referrals count

**Stats Display:**
```json
{
  "referralsThisRound": 5,
  "totalReferralEarnings": "0.15"
}
```

### API Endpoints

#### `GET /api/user/referrals`
Get referral statistics.

**Response:**
```json
{
  "totalReferrals": 42,
  "activeReferrals": 38,
  "totalEarningsEth": "0.42",
  "referralsThisRound": 5,
  "topReferrals": [
    { "fid": 12345, "guesses": 15, "hasWon": false }
  ]
}
```

---

## XP & Progression (v1)

### Overview

The XP system tracks player engagement and progression using an **event-sourced model**. Each XP-earning action creates a row in the `xp_events` table, allowing for flexible future features like breakdowns, streaks, and leaderboards.

**v1 Scope:**
- Backend tracks all XP events
- UI shows **Total XP only** in the Stats sheet
- Future milestones will add detailed XP views

### XP Event Types & Values

| Event Type | XP | Description |
|------------|-----|-------------|
| `DAILY_PARTICIPATION` | +10 | First valid guess of the day |
| `GUESS` | +2 | Each valid guess (free or paid) |
| `WIN` | +2,500 | Correctly guessing the secret word |
| `TOP_TEN_GUESSER` | +50 | Top 10 placement at round resolution |
| `REFERRAL_FIRST_GUESS` | +20 | Referrer earns when referred user makes first guess |
| `STREAK_DAY` | +15 | Each consecutive day playing (after day 1) |
| `CLANKTON_BONUS_DAY` | +10 | CLANKTON holder (100M+) daily participation |
| `SHARE_CAST` | +15 | Sharing to Farcaster (once per day) |
| `PACK_PURCHASE` | +20 | Each guess pack purchased |
| `NEAR_MISS` | 0 | Tracked for future use (Hamming distance 1-2) |

### Database Schema

```sql
CREATE TABLE xp_events (
  id SERIAL PRIMARY KEY,
  fid INTEGER NOT NULL,
  round_id INTEGER,
  event_type VARCHAR(50) NOT NULL,
  xp_amount INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Indexes:**
- `(fid, created_at DESC)` — Fast per-user XP queries
- `(round_id)` — Round-specific XP lookups
- `(event_type)` — Event type analytics

### Integration Points

XP events are logged at these code locations:

1. **Guess Submission** (`src/lib/daily-limits.ts`)
   - GUESS: On every valid guess
   - DAILY_PARTICIPATION: First guess of the day
   - CLANKTON_BONUS_DAY: First participation for CLANKTON holders
   - STREAK_DAY: If played yesterday
   - WIN: On correct guess

2. **Round Resolution** (`src/lib/economics.ts`)
   - TOP_TEN_GUESSER: For each top 10 guesser

3. **Referral Activation** (`src/lib/xp.ts`)
   - REFERRAL_FIRST_GUESS: When referred user makes first-ever guess

4. **Share Bonus** (`src/lib/daily-limits.ts`)
   - SHARE_CAST: When share bonus is awarded

5. **Pack Purchase** (`pages/api/purchase-guess-pack.ts`)
   - PACK_PURCHASE: For each pack purchased

### API Endpoints

#### `GET /api/user/xp?fid={fid}`

Get total XP for a user.

**Response:**
```json
{
  "fid": 12345,
  "totalXp": 1250
}
```

**Dev Mode Response** (when `LHAW_DEV_MODE=true`):
```json
{
  "fid": 12345,
  "totalXp": 1250,
  "breakdown": {
    "DAILY_PARTICIPATION": 100,
    "GUESS": 500,
    "WIN": 0,
    "TOP_TEN_GUESSER": 150,
    ...
  },
  "recentEvents": [
    { "id": 1, "eventType": "GUESS", "xpAmount": 2, "createdAt": "..." }
  ]
}
```

#### `GET /api/admin/xp-debug?fid={fid}` (Dev Mode Only)

Comprehensive XP debugging information.

**Response:**
```json
{
  "devMode": true,
  "userXp": { ... },
  "globalStats": {
    "totalXpAwarded": 125000,
    "totalEvents": 5000,
    "eventsByType": { ... },
    "topEarners": [ ... ],
    "recentGlobalEvents": [ ... ]
  }
}
```

### UI Display

**Stats Sheet** (`components/StatsSheet.tsx`):
- Total XP displayed with thousands separator
- "How to earn XP" section with all XP values
- Loading placeholder (`—`) until data loads

### Development & Debugging

**Environment Variables:**
- `XP_DEBUG=true` — Enable verbose XP console logging
- `LHAW_DEV_MODE=true` — Enable dev-only XP endpoints and extended responses

**Verification Queries:**
```sql
-- Get total XP for a user
SELECT COALESCE(SUM(xp_amount), 0) FROM xp_events WHERE fid = 12345;

-- Get XP breakdown by type
SELECT event_type, SUM(xp_amount) FROM xp_events WHERE fid = 12345 GROUP BY event_type;

-- Get recent events
SELECT * FROM xp_events WHERE fid = 12345 ORDER BY created_at DESC LIMIT 20;
```

### Future Milestones

The event-sourced design supports:
- XP breakdown views (per-source, per-round)
- Streak callouts and badges
- XP leaderboards (daily, weekly, all-time)
- XP-based cosmetics or game modes
- Achievement system based on XP milestones

---

## UX Design Guidelines

### Interjection Randomizer

The "Want another guess?" popup displays one of 25 random interjections to keep the experience fresh.

**Implementation** (`locales/en.json`):
```json
{
  "interjections": [
    "So close! 🎯",
    "Almost had it! 💪",
    "Nice try! Keep going! 🔥",
    "The word is still out there... 🔍",
    "Don't give up now! 🚀",
    // ... 20 more variations
  ]
}
```

**Usage:**
```typescript
import { useTranslation } from '../src/hooks/useTranslation';

function AnotherGuessModal() {
  const { getRandomInterjection } = useTranslation();
  const interjection = getRandomInterjection();

  return <h2>{interjection}</h2>;
}
```

**Rules:**
- Show random interjection each time modal appears
- Do not repeat same interjection consecutively
- Localization-ready (can translate all 25 phrases)

### Haptics Patterns

All haptic feedback uses the Farcaster MiniApp SDK:

| Action | Pattern | Function |
|--------|---------|----------|
| Key press | Light tap | `haptics.keyTap()` |
| Guess submitting | Medium impact | `haptics.guessSubmitting()` |
| Invalid word | Error vibration | `haptics.invalidWord()` |
| Wrong guess | Subtle feedback | `haptics.wrongGuess()` |
| Correct guess | Success pattern | `haptics.correctGuess()` |
| Pack purchased | Success notification | `haptics.packPurchased()` |
| Link copied | Medium impact | `haptics.linkCopied()` |
| Share completed | Success notification | `haptics.shareCompleted()` |
| Card saved | Medium impact | `haptics.cardSaved()` |
| Losing state | Warning | `haptics.losing()` |
| Winning state | Success | `haptics.winning()` |

**Implementation** (`src/lib/haptics.ts`):
```typescript
import sdk from '@farcaster/miniapp-sdk';

const haptics = {
  packPurchased: () => sdk.haptics.notificationOccurred("success"),
  linkCopied: () => sdk.haptics.impactOccurred("medium"),
  shareCompleted: () => sdk.haptics.notificationOccurred("success"),
  cardSaved: () => sdk.haptics.impactOccurred("medium"),
  losing: () => sdk.haptics.notificationOccurred("warning"),
  winning: () => sdk.haptics.notificationOccurred("success"),
};
```

### Share Card Design Rules

**WinnerShareCard** design guidelines:

1. **Background**: Purple gradient (`from-purple-600 via-purple-700 to-indigo-800`)
2. **Pattern**: Subtle radial gradient dots at 10% opacity
3. **Round Badge**: Top-left, white/20 background with backdrop blur
4. **Typography**:
   - Title: 3xl bold white with text shadow
   - Word: 4xl bold white uppercase with letter-spacing
   - Jackpot: 3xl bold on yellow/orange gradient background
5. **CLANKTON Mascot**: Show 🐟 emoji with 🎉 for holders only
6. **Text Smoothing**: `fontSmooth: 'always'`, `WebkitFontSmoothing: 'antialiased'`

**Share Text Format:**
```
I just hit the {jackpot} ETH jackpot on Let's Have A Word! 🎉🟩

I found the winning word "{word}" in round #{roundId}!

@letshaveaword
https://lets-have-a-word.vercel.app
```

**Button Styling:**
- Farcaster: Purple (#6A3CFF) with Farcaster icon
- X/Twitter: Black with 𝕏 symbol
- Both: Full width, rounded-xl, shadow-lg, active:scale-95

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

**Last Updated**: December 2025
**Version**: 11.0 (Milestone 11 - Production Hardening & Onchain Pack Purchases)
**Status**: Production
