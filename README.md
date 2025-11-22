# Let's Have A Word! 💬

**Massively multiplayer word hunt where everyone eliminates wrong answers until one player hits the ETH jackpot**

## Overview

**Let's Have A Word** is a Farcaster mini app where:
- **ONE** secret 5-letter word per round, shared globally
- Everyone in the world guesses the same word
- Wrong guesses appear on a spinning wheel for all to see
- The word only changes when someone guesses it correctly
- First correct guesser wins an ETH jackpot

## 🎯 Current Status: Milestone 4.13 Complete

All core game mechanics, onchain integration, social features, and UX polish are fully implemented and production-ready:

### ✅ Milestone 4.13 - Clean English Dictionary (Latest)

Replaced Wordle-derived dictionaries with clean, modern English wordlists free of Scrabble garbage:

- **Clean Dictionaries**
  - **GUESS_WORDS_CLEAN**: 10,014 words (all valid guesses)
  - **ANSWER_WORDS_EXPANDED**: 7,520 words (curated answer candidates)
  - Located in `src/data/guess_words_clean.ts` and `src/data/answer_words_expanded.ts`
  - All words in UPPERCASE for consistency
  - Invariant maintained: ANSWER_WORDS_EXPANDED ⊆ GUESS_WORDS_CLEAN

- **Filtering Criteria**
  - No Scrabble/crossword garbage (AALII, AARGH, XYSTI, etc.)
  - No offensive words or slurs
  - No proper nouns (names, places, brands)
  - No archaic or extremely obscure terms
  - Real, modern English vocabulary

- **Plural Handling**
  - Heuristic-based plural detection
  - Plurals allowed in guess dictionary
  - Most plurals excluded from answer dictionary
  - Common/essential plurals may be included

- **Generation Scripts**
  - `src/scripts/generate-wordnik-dictionaries.ts` - Wordnik API integration (requires API key)
  - `src/scripts/filter-existing-dictionaries.ts` - Practical filtering script (used for current lists)
  - Comprehensive blacklists for offensive, archaic, and proper noun words
  - Pattern-based filtering for uncommon letter combinations

- **Integration**
  - Updated `src/lib/word-lists.ts` to use clean dictionaries
  - All game logic now uses filtered word lists
  - Backward compatible with existing game state
  - Updated tests to verify no garbage words

### ✅ Milestone 4.12 - ETH/USD Price Integration

Real-time ETH→USD conversion for the jackpot display using CoinGecko's free API:

- **CoinGecko Integration**
  - Uses CoinGecko Simple Price API (no API key required)
  - Fetches live ETH/USD price from `https://api.coingecko.com/api/v3/simple/price`
  - 1-minute client-side caching to avoid rate limits
  - Zero configuration required

- **Price Module**
  - New `src/lib/prices.ts` module for price fetching
  - `getEthUsdPrice()` async function with caching
  - Graceful error handling and fallback to last known price
  - Never blocks or throws errors in UI

- **UI Updates**
  - Top ticker displays both ETH and USD amounts
  - Format: "0.123 ETH ($421.50)"
  - Shows "..." if price unavailable
  - USD is informational only - all payouts remain 100% ETH

- **Error Handling**
  - Falls back to last cached price on API failure
  - Shows ETH only if no cached price available
  - No UI freezes or dependency issues
  - Seamless integration with Farcaster miniapp

- **Dev Mode Support**
  - Works in both LHAW_DEV_MODE and NEXT_PUBLIC_TEST_MID_ROUND
  - Live prices in dev mode match production behavior
  - Consistent USD formatting across all environments

### ✅ Milestone 4.11 - Final Word List Integration

Finalized integration of canonical word lists from the official Wordle word sets:

- **Canonical Word Lists**
  - **ANSWER_WORDS**: 2,279 curated words (valid answers only)
  - **GUESS_WORDS**: 10,516 words (all valid guesses, includes all ANSWER_WORDS)
  - Located in `src/data/answer_words.ts` and `src/data/guess_words.ts`
  - All words in UPPERCASE for consistency
  - Invariant maintained: ANSWER_WORDS ⊆ GUESS_WORDS

- **Integration**
  - Answer selection uses ANSWER_WORDS exclusively
  - Guess validation uses GUESS_WORDS
  - Wheel rendering displays all GUESS_WORDS with status
  - SEED_WORDS deprecated and removed from game logic

- **Word List Processing**
  - Filtered from official Wordle lists
  - Simple plurals removed (no words ending in 'S')
  - Deduplicated and alphabetized
  - Exactly 5 letters, A-Z only

### ✅ Milestone 4.10 - Global Wheel Over All Guessable Words

Redesigned the word wheel to show the complete universe of guessable words from the start:

- **Global Word Wheel**
  - Displays ALL ~10,000 GUESS_WORDS from round start
  - Each word has a status: `unguessed`, `wrong`, or `winner`
  - Creates a global, real-time elimination board shared by all players
  - No more seed words - wheel reflects actual game state

- **Status-Based Rendering**
  - `unguessed` - Gray, default state for all words at round start
  - `wrong` - Red, word was guessed incorrectly by someone
  - `winner` - Gold with glow, the correct answer (only shown after win)
  - Backend derives status per word based on round state

- **Word List Model** (See Milestone 4.11 for latest)
  - Wheel displays all GUESS_WORDS from the start
  - Status-based rendering (unguessed/wrong/winner)
  - SEED_WORDS removed - no longer needed

- **Updated API Contract**
  - `/api/wheel` returns `WheelResponse` with per-word status
  - Response includes `totalWords`, `roundId`, and array of `{word, status}` objects
  - Frontend uses status for styling instead of client-side derivation

- **Performance**
  - Virtualized scrolling handles 10k+ words efficiently
  - Alphabetical sorting maintained
  - Auto-scroll to user input position

### ✅ Milestone 4.9 - Non-Referral Prize Flow

Updated jackpot settlement to prevent players from gaming the referral system:

- **Non-Referral Prize Logic**
  - When a winner has no referrer, the 10% referrer share is NOT given to the winner
  - Instead, it flows through the seed + creator pipeline:
    1. First fills next-round seed (up to 0.1 ETH cap)
    2. Any overflow goes to creator wallet
  - Prevents incentive to avoid using referral links
  - Keeps the growth loop healthy

- **Schema Updates**
  - `roundPayouts.fid` is now nullable for system payouts
  - New payout roles: 'seed' and 'creator' (in addition to 'winner', 'referrer', 'top_guesser')
  - Analytics-ready payout tracking

- **Settlement Logic**
  - New `allocateToSeedAndCreator()` helper function
  - Automatic seed accumulation when referrer is missing
  - Creator balance overflow handling
  - Full payout records for transparency

### ✅ Milestone 4.8 - Dev Mode Game Preview

Enhanced development workflow with realistic mid-round testing and game state preview:

- **Dev Mode Preview Endpoint**
  - New `/api/game` unified state endpoint
  - Returns complete game state in one request
  - Supports forced preview states for UI testing
  - Query params: `?devState=RESULT_CORRECT&devInput=CRANE`

- **Backend State Management**
  - Backend-controlled preview states: `SUBMITTING`, `RESULT_CORRECT`, `RESULT_WRONG_VALID`, `OUT_OF_GUESSES`
  - Solution word revealed in dev mode for testing (`devSolution`)
  - Realistic state simulation without affecting database

- **Improved Testing Workflow**
  - Test success/failure states without actual submissions
  - Preview out-of-guesses state
  - Verify UI behavior for all game states
  - Complements existing mid-round test mode (Milestone 4.5)

### ✅ Milestone 4.7 - Haptics Integration

Fully integrated haptics across the game using the Farcaster mini-app SDK for tactile feedback:

- **Haptics Utility Module**
  - Centralized `lib/haptics.ts` wrapping Farcaster SDK haptics API
  - Capability detection via `sdk.getCapabilities()`
  - Graceful fallback on unsupported devices
  - Error swallowing to prevent app breakage
  - Semantic helper functions for common interactions

- **Keyboard Haptics**
  - Light impact on letter key presses (`keyTap`)
  - Soft impact on backspace (`keyBackspace`)
  - Medium impact on Enter/Guess when valid (`keyEnterValid`)

- **Input State Haptics**
  - Selection feedback when word becomes valid (`inputBecameValid`)
  - Error notification for invalid/duplicate words (`inputBecameInvalid`)
  - Automatic state transition detection via `useInputStateHaptics` hook
  - No redundant haptics on re-renders

- **Guess Lifecycle Haptics**
  - Medium impact on guess submission (`guessSubmitting`)
  - Success notification on correct guess (`guessSuccess`)
  - Rigid impact on wrong but valid guess (`guessWrong`)
  - Warning notification when out of guesses (`outOfGuesses`)

- **UI Element Haptics**
  - Light impact on Stats/Refer/FAQ button taps (`buttonTapMinor`)
  - Success notification when share bonus unlocked (`shareBonusUnlocked`)
  - Share button tap feedback

- **Best Practices Applied**
  - Used sparingly (only meaningful interactions)
  - Intensity matched to action importance
  - Always paired with visual feedback
  - Capability checking before use
  - Silent failure in unsupported environments

### ✅ Milestone 4.6 - Input States & Visual Behavior

Comprehensive input state machine for consistent visual feedback and error handling:

- **State Machine Architecture**
  - 10 distinct input states: IDLE_EMPTY, TYPING_PARTIAL, TYPING_FULL_VALID, TYPING_FULL_INVALID_NONSENSE, TYPING_FULL_INVALID_ALREADY_GUESSED, SUBMITTING, RESULT_CORRECT, RESULT_WRONG_VALID, OUT_OF_GUESSES
  - Single source of truth for all input state logic
  - Deterministic state transitions based on user input
  - Centralized in `src/lib/input-state.ts`

- **Visual Feedback System**
  - State-based border colors (gray, blue, red, green)
  - Dynamic box styling based on current state
  - "Ready to guess" glow effect for valid 5-letter words
  - Disabled state when out of guesses
  - Result states for correct/incorrect feedback

- **Error Message System**
  - State-driven error messages appear below input
  - "Not a valid word" for nonsense words
  - "Already guessed this round" for duplicate guesses
  - "No guesses left today" when out of guesses
  - Auto-dismiss after 2 seconds with smooth fade-out
  - Manual dismissal available

- **GUESS Button Logic**
  - Only enabled when state is TYPING_FULL_VALID
  - Automatically disabled for invalid words
  - Prevents submission of duplicate or nonsense guesses
  - Visual feedback synchronized with input state

- **UI Polish**
  - Error messages position below input boxes with smooth transitions
  - Consistent spacing and padding throughout interface
  - Rounded background blocker behind input boxes
  - Sentence case headers in Stats and Referral sheets
  - Purple color for CLANKTON and ETH earned (brand consistency)
  - Improved keyboard interaction and backspace behavior

- **Integration**
  - Wheel now receives inputState for synchronized behavior
  - LetterBoxes component uses state machine for styling
  - GameKeyboard disables during invalid states
  - All UI components respond to state changes

### ✅ Milestone 4.5 - Mid-Round Test Mode

Development-only test mode that simulates an active round in progress for easier local testing:

- **Dev-Only Test Mode**
  - Fully gated behind `NEXT_PUBLIC_TEST_MID_ROUND=true` environment flag
  - Automatically creates a test round with realistic mid-round state
  - Never runs in production (safety checks at multiple levels)

- **Realistic Test Data**
  - Pre-populated with 50-100 wrong guesses from fake users
  - Non-zero jackpot (0.42 ETH for testing)
  - Mix of paid and free guesses
  - Seed words and wheel fully populated

- **Separate Test Word Lists**
  - Dedicated `src/lib/testWords.ts` with dev-only word lists
  - No overlap with production word lists
  - Large pools for varied testing scenarios

- **Database Support**
  - New `is_dev_test_round` column on `rounds` table
  - Allows filtering test rounds from analytics
  - Clean separation from production data

- **Easy Enable/Disable**
  - Set `NEXT_PUBLIC_TEST_MID_ROUND=true` in `.env.local`
  - Restart dev server to activate
  - All normal UX elements work as if in real mid-round

**Perfect for:**
- Testing wheel UI with many guesses
- Developing jackpot and payout features
- Demonstrating the app in a "busy" state
- Avoiding empty round during local development

### ✅ Milestone 4.4 - Custom In-App Keyboard

Replaced native mobile keyboard with a custom in-app keyboard for consistent cross-device input:

- **Custom Keyboard Component**
  - QWERTY layout optimized for 5-letter A-Z input
  - Always visible at bottom of screen on mobile
  - Backspace and GUESS keys integrated
  - Touch-optimized button sizes
  - Haptic feedback on key presses
  - Disabled state during guess submission

- **Hardware Keyboard Support**
  - Desktop users can still use physical keyboards
  - A-Z letters, Backspace, and Enter keys supported
  - Seamless fallback for non-touch devices

- **Mobile Optimization**
  - Native keyboard no longer appears on mobile
  - Consistent behavior across all browsers and devices
  - No layout shifts from keyboard appearing/disappearing
  - Hidden input with `inputMode="none"` for accessibility

- **Integration**
  - Wired into existing letter state and guess flow
  - Same validation and submission logic
  - Works with wheel UI and visual feedback system
  - Disabled when modals/sheets are open

### Custom In-App Keyboard

Let's Have A Word uses a custom in-app keyboard for entering guesses, instead of relying on the native mobile keyboard.

- The keyboard is optimized for 5-letter A–Z input.
- It provides consistent behavior across browsers and devices.
- On desktop, hardware keyboards are still supported:
  - Type letters, Backspace to delete, and Enter to submit a guess.
- On mobile, the in-app keyboard ensures the input experience is always available and stable, without depending on the OS to automatically show the native keyboard.

### ✅ Milestone 4.3 - Core UX Polish

Comprehensive user experience improvements:

- **5-Letter Box Input**
  - Visual letter boxes replacing single input field
  - Individual boxes for each letter with green borders when filled
  - Mobile keyboard auto-focus with iOS Safari compatibility
  - Backspace handling (right-to-left deletion)
  - Character counter beneath boxes
  - Smooth typing experience with visual feedback

- **Haptic Feedback**
  - Integrated with Farcaster SDK haptic API
  - Light haptic on button taps and navigation
  - Medium haptic on guess submission
  - Error haptic on invalid guesses
  - Success haptic on jackpot wins
  - Graceful fallback on unsupported devices

- **Shake Animation**
  - Visual shake effect on invalid inputs
  - Triggered for validation errors and invalid words
  - 400ms duration with left-right oscillation
  - CSS keyframe-based animation

- **First-Time User Overlay**
  - Tutorial overlay for new players
  - Explains game mechanics, bonuses, and fairness
  - Four sections: How It Works, Your Guesses, The Jackpot, Provably Fair
  - Tracked via `hasSeenIntro` in user schema
  - Shows once per user, dismissed permanently

- **Stats Sheet**
  - Bottom sheet modal displaying gameplay statistics
  - This Round: total guesses, paid guesses
  - All Time: total guesses, paid guesses
  - Jackpots: wins and total ETH earned
  - Color-coded sections (blue, purple, green)
  - API endpoint: `/api/user/stats`

- **Referral Sheet**
  - Display referral link with copy button
  - Referral stats: count and ETH earned
  - One-tap copy with haptic feedback
  - "How it Works" explanation
  - API endpoint: `/api/user/referrals`

- **FAQ Sheet**
  - Accordion-style comprehensive FAQ
  - 12 questions covering all game mechanics
  - Topics: free guesses, paid guesses, CLANKTON, sharing, jackpot, fairness, referrals, XP
  - Collapsible answers for easy scanning

- **XP Sheet Placeholder**
  - Shows current XP balance
  - "Coming Soon" messaging
  - Lists future XP features: progression, leaderboards, rewards, achievements
  - How to earn XP explanation

- **Navigation Buttons**
  - Four buttons below GUESS button: Stats, Refer, FAQ, XP
  - Grid layout with icons
  - Haptic feedback on tap
  - Clean white design with borders

- **Database Updates**
  - Added `hasSeenIntro` to users table
  - Added `username` and `custodyAddress` fields
  - Migration: `0004_white_millenium_guard.sql`

### ✅ Milestone 4.2 - Share-for-Bonus System

Social engagement rewards:

- **Share Prompt Modal**
  - Appears after each guess (correct or incorrect)
  - Invites users to share to Farcaster for +1 free guess
  - Clean, user-friendly modal UI with "Share" and "Not now" options

- **Farcaster Composer Integration**
  - Opens Farcaster's native composer with prefilled text
  - Includes guess word, round number, and game link
  - Seamless integration with Farcaster SDK

- **Share Verification**
  - `/api/share-callback` endpoint verifies share completion
  - Awards +1 free guess instantly
  - One share bonus per day maximum
  - Updates user state in real-time

- **User State Display**
  - Share bonus shown in guess allocation breakdown
  - Visual indicator for share bonus (+1)
  - Clear messaging about daily limit

- **Database Tracking**
  - `hasSharedToday` flag prevents duplicate claims
  - `freeAllocatedShareBonus` tracks bonus allocation
  - Resets daily at 11:00 UTC

### ✅ Milestone 4.1 - CLANKTON Integration

Onchain token bonus system:

- **Real Balance Checking**
  - Queries CLANKTON balance on Base network
  - Uses ethers.js and Base RPC
  - Checks user's Farcaster signer wallet

- **Bonus System**
  - Holding ≥ 100M CLANKTON → +3 free guesses per day
  - Verified onchain at daily reset
  - Contract: `0x461DEb53515CaC6c923EeD9Eb7eD5Be80F4e0b07`

- **Wallet Integration (Wagmi)**
  - Automatic wallet connection via Farcaster SDK
  - Uses `@farcaster/miniapp-wagmi-connector`
  - Live balance checking from connected wallet
  - Supports both Farcaster verified addresses and connected wallets

- **User State UI**
  - Live display of remaining guesses (free + paid)
  - CLANKTON bonus status indicator
  - Daily allocation breakdown
  - Buy more guesses button
  - Real-time updates after each guess

- **On-Demand User Creation**
  - Users created automatically on first visit
  - Fetches data from Neynar API
  - Stores wallet address for bonus checking

- **Configuration**
  - `BASE_RPC_URL` environment variable
  - Defaults to `https://mainnet.base.org`
  - Graceful error handling

### ✅ Milestone 3.2 - Top Ticker Polish

Live round status display with polished formatting:

- **Live Jackpot Display**
  - Shows current prize pool in ETH (from database)
  - Live USD equivalent from CoinGecko API (Milestone 4.12)
  - Proper formatting (trims trailing zeros, commas for USD)

- **Global Guess Counter**
  - Total guesses for current round
  - Formatted with thousand separators

- **Efficient Polling**
  - Updates every 15 seconds
  - Graceful error handling and loading states

- **Configuration**
  - CoinGecko integration for real-time ETH/USD conversion (Milestone 4.12)
  - No API keys required
  - `ETH_USD_RATE` environment variable support (deprecated, fallback only for backwards compatibility)

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
  - Daily reset at 11:00 UTC
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

### ✅ Milestone 1.2 - Round Lifecycle

Complete round management system:

- **Round Creation**
  - Generate random salt per round
  - Pick random answer from ANSWER_WORDS
  - Implement SHA-256 commit-reveal hashing
  - Initialize jackpot from previous round seed
  - Initialize next-round seed at zero
  - Store ruleset_id per round

- **Round Resolution**
  - Winner and referrer settlement logic
  - Top 10 guesser payouts
  - Commit-reveal verification
  - Automatic new round creation

- **Provable Fairness**
  - Commit hash published before round starts
  - Salt and answer revealed on resolution
  - Anyone can verify integrity

### ✅ Milestone 1.1 - Data Model + Rules

Foundation database schema and word lists:

- **Database Tables**
  - `game_rules` table with JSON ruleset config
  - `users` table schema
  - `rounds`, `guesses`, `daily_guess_state` tables
  - Proper foreign key relationships

- **Word Lists**
  - Import ANSWER_WORDS list (~2,500 words, now 2,279 in 4.11)
  - Import GUESS_WORDS list (~10,000 words, now 10,516 in 4.11)
  - Import SEED_WORDS list (deprecated in Milestone 4.11)
  - Validate no overlap between answer and seed lists

- **Rules System**
  - getRulesForRound() function
  - Implement ruleset_id per round
  - Store ruleset_id per round
  - JSON-based flexible configuration

## Tech Stack

- **Frontend**: Next.js 14, React, Tailwind CSS
- **Backend**: TypeScript, Node.js
- **Database**: PostgreSQL (Neon)
- **ORM**: Drizzle ORM
- **Authentication**: Farcaster (Neynar SDK)
- **Wallet**: Wagmi + @farcaster/miniapp-wagmi-connector
- **Blockchain**: ethers.js v6 (Base network)
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
# - BASE_RPC_URL (optional, for CLANKTON balance checking)
# Note: ETH_USD_RATE env var is deprecated as of Milestone 4.12 (uses CoinGecko API)
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

### Mid-Round Test Mode (Development Only)

To test the app in a realistic "mid-round" state with existing guesses and a jackpot:

1. **Enable test mode** in your `.env.local` file:
   ```bash
   NEXT_PUBLIC_TEST_MID_ROUND=true
   ```

2. **Restart your dev server** for the env variable to take effect:
   ```bash
   npm run dev
   ```

3. **Access the app** - The first time you load `/api/round-state`, `/api/guess`, or `/api/wheel`, the system will automatically create a dev test round with:
   - 50-100 pre-populated wrong guesses
   - Non-zero jackpot (0.42 ETH)
   - Fully populated wheel
   - Mix of paid/free guesses

4. **Test normally** - All game mechanics work as if this were a real active round. You can submit guesses, see the wheel, check the jackpot, etc.

5. **Disable test mode** when done:
   ```bash
   NEXT_PUBLIC_TEST_MID_ROUND=false
   ```
   Or simply remove the line from `.env.local`.

**Important Notes:**
- This mode **NEVER runs in production** - it has multiple safety checks
- Test rounds are marked with `is_dev_test_round = true` in the database
- Test word lists are separate from production word lists
- Perfect for UI development, screenshots, and demos

## API Endpoints

### Game API

- `POST /api/guess` - Submit a guess
  - Requires: `{ word, frameMessage?, signerUuid?, ref?, devFid? }`
  - Returns: Guess result (correct, incorrect, invalid, etc.)

- `GET /api/round-state` - Get current round status (Milestone 4.12: with live ETH/USD)
  - Returns: `{ roundId, prizePoolEth, prizePoolUsd, globalGuessCount, lastUpdatedAt }`
  - `prizePoolUsd` is live from CoinGecko API (60s cache)
  - Falls back to ETH only if price unavailable

- `GET /api/wheel` - Get wheel words
  - Returns: `{ roundId, words[] }` (seed words + wrong guesses)

- `GET /api/user-state` - Get user's daily guess allocations (Milestone 4.1)
  - Requires: `devFid` or `frameMessage` param
  - Returns: `{ fid, freeGuessesRemaining, paidGuessesRemaining, totalGuessesRemaining, clanktonBonusActive, freeAllocations, paidPacksPurchased, maxPaidPacksPerDay, canBuyMorePacks }`

- `POST /api/share-callback` - Award share bonus (Milestone 4.2)
  - Requires: `{ fid, castHash }`
  - Returns: `{ ok, newFreeGuessesRemaining?, message? }`
  - Awards +1 free guess if share bonus not claimed today

- `GET /api/user/stats` - Get user gameplay statistics (Milestone 4.3)
  - Requires: `devFid` or `fid` param
  - Returns: `{ guessesThisRound, guessesAllTime, paidGuessesThisRound, paidGuessesAllTime, jackpotsWon, totalEthWon }`

- `GET /api/user/referrals` - Get user referral data (Milestone 4.3)
  - Requires: `devFid` or `fid` param
  - Returns: `{ referralLink, referralsCount, referralEthEarned }`

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

**`round_seed_words`** - ~~Wheel seed words~~ (Deprecated in Milestone 4.10)
- No longer used - wheel now shows all GUESS_WORDS with derived status
- Table retained for historical data only

**`system_state`** - System-wide state (Milestone 3.1)
- Creator balance (accumulated from 20% fee overflow)

**`round_payouts`** - Payout records (Milestone 3.1, updated 4.9)
- Winner, referrer, and top guesser payouts
- Seed and creator payouts (Milestone 4.9)
- Amount in ETH
- Role tracking ('winner', 'referrer', 'top_guesser', 'seed', 'creator')
- FID is nullable for system payouts (seed/creator)

## Game Mechanics

### Wheel Behavior

The wheel shows **all possible guessable words** (GUESS_WORDS) from the start of each round.

Every word begins in the `unguessed` state. As guesses come in:

- Valid wrong guesses → word becomes `wrong` (red)
- The winning guess → word becomes `winner` (gold with glow)

This creates a global, real-time elimination board shared by every player. As more guesses are made, the wheel fills with red words, narrowing down the possibilities for everyone.

**Scroll Behavior**
- As you type, the wheel auto-scrolls to show words matching your input alphabetically
- Typing partial words (1-4 letters) scrolls to that prefix range
- Typing a complete 5-letter word centers on that exact word
- Words are styled with a faux-3D effect based on distance from center

### Guessing System

**Free Guesses (per day)**
- 1 base free guess
- +3 for CLANKTON holders (≥100M tokens)
- +1 for sharing to Farcaster

**Paid Guesses (per day)**
- Buy packs of 3 guesses for 0.0003 ETH each
- Up to 3 packs per day (9 paid guesses max)

### Share Bonus

Users can earn **1 extra free guess per day** by sharing their previous guess to Farcaster.

- After each guess, a modal invites the user to share.
- Sharing opens a prefilled Farcaster composer.
- When the cast is successfully published, the app verifies via `/api/share-callback`.
- Bonus is added instantly: +1 free guess for the current day.
- Share bonus can only be earned once per day.
- Maximum free guesses per day:
  - 1 (base)
  - +3 if holding ≥100M CLANKTON
  - +1 share bonus

### Economics (Milestone 3.1, Updated in 4.9)

**Per Paid Guess (80/20 Split)**
- 80% → Prize pool
- 20% → Seed for next round (capped at 0.1 ETH)
  - Overflow → Creator balance

**Jackpot Resolution (80/10/10 Split)**
- 80% → Winner
- 10% → Referrer (or seed + creator if no referrer - see below)
- 10% → Top 10 guessers (split equally)

**Non-Referral Prize Flow (Milestone 4.9)**

When a winner **has a referrer**:
- Winner gets 80%
- Referrer gets 10%
- Top 10 get 10%

When a winner **does NOT have a referrer**:
- Winner gets 80%
- Top 10 get 10%
- The unused 10% referrer share goes to:
  1. Next-round seed (up to 0.1 ETH cap)
  2. Creator wallet (any remaining overflow)

This prevents players from avoiding referral links to maximize their payout and keeps the growth loop healthy.

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
1. User opens mini app → Wallet auto-connects via Farcaster SDK
2. Frontend gets wallet address using Wagmi
3. Backend queries CLANKTON balance onchain (live check)
4. If balance ≥ 100M tokens → +3 free guesses per day
5. Bonus recalculated at daily reset (11:00 UTC)

**Wallet Connection:**
- Uses Wagmi with Farcaster miniapp connector
- Automatically connects to user's wallet via Farcaster SDK
- If no connected wallet, falls back to Farcaster verified addresses
- Live CLANKTON balance check from connected wallet

**Configuration:**
- Set `BASE_RPC_URL` in `.env` for custom RPC endpoint
- Defaults to `https://mainnet.base.org`

### ETH → USD Conversion (Milestone 4.12)

The prize pool is displayed in both ETH and USD for user convenience using live market data.

- **Price Source**: CoinGecko Simple Price API
  - Free tier, no API key required
  - Endpoint: `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`
  - Global cryptocurrency market data provider

- **Implementation Details**
  - Module: `src/lib/prices.ts`
  - Function: `getEthUsdPrice()` - async price fetcher
  - Integration: Called in `getRoundStatus()` via `Promise.all()` for parallel fetching
  - Format: Always displays 2 decimal places (e.g., "$3,421.50")

- **Caching Strategy**
  - 60-second cache per server instance (module-level variables)
  - `cachedEthUsd` stores last successful price
  - `cachedAt` tracks cache timestamp
  - Reduces API calls and improves performance
  - Falls back to last cached price on API errors

- **Error Handling**
  - If CoinGecko is unavailable, uses last known price
  - If no cached price exists, shows ETH only (no USD)
  - Never blocks UI rendering or throws errors
  - Console logs errors for debugging without user impact

- **Dev Mode Support**
  - Works in `LHAW_DEV_MODE=true` (interactive dev mode)
  - Works in `NEXT_PUBLIC_TEST_MID_ROUND=true` (mid-round test mode)
  - Provides realistic testing with live market prices
  - Consistent behavior across dev and production

- **Important Notes**
  - USD amount is **informational only**
  - All rewards and payouts remain **100% ETH-based**
  - Works seamlessly inside the Farcaster miniapp
  - No configuration required
  - No environment variables needed
  - Backwards compatible (deprecated `ETH_USD_RATE` still works as fallback)

## User Experience (Milestone 4.3)

### Input System

**5-Letter Box UI**
- Visual representation of each letter position
- Individual boxes with green borders when filled
- Mobile-first design with auto-focus
- Character counter showing progress (0/5 to 5/5)
- Backspace deletes from right to left
- Only letters A-Z accepted
- Uppercase conversion automatic

**Mobile Keyboard Handling**
- Auto-focus on iOS Safari with delay
- Hidden input field for keyboard management
- Click anywhere on boxes to focus
- Enter key disabled (forces GUESS button tap)

### Haptics Integration

Let's Have A Word uses Farcaster mini-app haptics to make the game feel more tactile on supported devices:

- **Keyboard taps** use light impact feedback.
- The input boxes use haptics when a word becomes valid or invalid.
- Guess submissions, correct guesses, wrong guesses, and out-of-guesses all trigger distinct feedback patterns.
- Share bonuses and certain UI actions (e.g. Stats / Refer / FAQ) also provide subtle feedback.

**Implementation details:**

- Haptics are implemented via `@farcaster/miniapp-sdk` (`sdk.haptics.*`).
- A central helper module (`lib/haptics.ts`) wraps the SDK:
  - Checks `sdk.getCapabilities()` once at startup.
  - No-ops gracefully when haptics are unavailable.
  - Exposes semantic methods like `keyTap`, `guessSuccess`, `guessWrong`, etc.
- Haptics are **optional** and never affect game logic. They provide feedback only and are safe to ignore on unsupported devices.

**Haptic Types Used:**
- **Impact**: `light`, `soft`, `medium`, `rigid` - Physical feedback for actions
- **Notification**: `success`, `warning`, `error` - Semantic feedback for events
- **Selection**: Selection changed feedback for state transitions

**Integration Points:**
- Letter key taps → light impact
- Backspace → soft impact
- Valid word completion → selection changed
- Invalid word → error notification
- Guess submission → medium impact
- Correct guess → success notification
- Wrong guess → rigid impact
- Out of guesses → warning notification
- Share bonus unlocked → success notification
- UI button taps (Stats/Refer/FAQ) → light impact

### Visual Feedback

**Shake Animation**
- Triggered on validation errors
- 400ms duration
- Left-right oscillation (-8px to +8px)
- Applied to letter boxes
- CSS keyframe-based for smooth performance

**Trigger Conditions**
- Word length ≠ 5 letters
- Invalid word (not in dictionary)
- Already guessed word
- API errors

### First-Time User Experience

**Tutorial Overlay**
- Shows once per user on first visit
- Tracked via `hasSeenIntro` database field
- Full-screen modal with scroll support

**Content Sections**
1. **How It Works** - Global word, wheel, jackpot
2. **Your Guesses** - Free, CLANKTON, share, paid
3. **The Jackpot** - 80/10/10 split explanation
4. **Provably Fair** - Commit-reveal explanation

**Dismissal**
- "Got it!" button
- Updates `hasSeenIntro` to true
- Never shows again for that user

### Information Sheets

**Stats Sheet (📊)**
- Accessible via navigation button
- Bottom sheet modal pattern
- Click outside to close

Stats displayed:
- **This Round**: Total guesses, paid guesses
- **All Time**: Total guesses, paid guesses
- **Jackpots**: Wins count, total ETH won

**Referral Sheet (🔗)**
- Accessible via navigation button
- Shows personalized referral link
- Copy button with haptic feedback
- Visual confirmation on copy

Referral data:
- Unique referral link with FID
- Total referrals count
- ETH earned from referrals
- "How it Works" explanation

**FAQ Sheet (❓)**
- Accessible via navigation button
- Accordion-style collapsible answers
- 12 comprehensive questions

Topics covered:
- How the game works
- Free vs paid guesses
- CLANKTON bonus
- Share bonus
- Jackpot mechanics
- Provably fair system
- Referral system
- XP tracking

**XP Sheet (⭐)**
- Accessible via navigation button
- Shows current XP balance
- "Coming Soon" messaging

Future features listed:
- XP-based progression
- Leaderboards and rankings
- Unlockable rewards
- Achievement badges
- Special perks

### Navigation

**Bottom Navigation Grid**
- 4-button layout below GUESS button
- Icons + labels for clarity
- White background with borders
- Haptic feedback on tap
- Responsive grid layout

Buttons:
1. 📊 Stats - Personal statistics
2. 🔗 Refer - Referral program
3. ❓ FAQ - Help and info
4. ⭐ XP - Progression (placeholder)

### Accessibility

- Large tap targets (minimum 44x44px)
- Clear visual feedback on all interactions
- Haptic feedback for tactile confirmation
- High contrast text and borders
- Mobile-optimized layouts
- Keyboard support for desktop

## Project Structure

```
src/
├── config/            # Configuration
│   └── wagmi.ts           # Wagmi wallet config
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
│   ├── clankton.ts        # CLANKTON bonus checking
│   ├── prices.ts          # ETH/USD price fetching (Milestone 4.12)
│   ├── haptics.ts         # Haptic feedback SDK wrapper (Milestone 4.7)
│   ├── input-state-haptics.ts  # Haptic feedback hook (Milestone 4.7)
│   ├── input-state.ts     # Input state machine (Milestone 4.6)
│   ├── testWords.ts       # Dev-only test word lists (Milestone 4.5)
│   └── devMidRound.ts     # Mid-round test mode (Milestone 4.5)
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
│   ├── user-state.ts      # User daily allocations
│   ├── share-callback.ts  # Share bonus verification
│   ├── wheel.ts           # Wheel data
│   └── user/              # User endpoints (Milestone 4.3)
│       ├── stats.ts       # User statistics
│       └── referrals.ts   # Referral data
├── _app.tsx           # App wrapper (Wagmi + Farcaster SDK)
└── index.tsx          # Main game UI

components/
├── Wheel.tsx              # Spinning word wheel
├── TopTicker.tsx          # Live status ticker
├── UserState.tsx          # User guess allocations & CLANKTON bonus
├── SharePromptModal.tsx   # Share-to-earn modal (Milestone 4.2)
├── LetterBoxes.tsx        # 5-letter input boxes (Milestone 4.3)
├── FirstTimeOverlay.tsx   # Tutorial for new users (Milestone 4.3)
├── StatsSheet.tsx         # User statistics sheet (Milestone 4.3)
├── ReferralSheet.tsx      # Referral link & stats (Milestone 4.3)
├── FAQSheet.tsx           # FAQ accordion (Milestone 4.3)
└── XPSheet.tsx            # XP placeholder (Milestone 4.3)

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

### 🚧 Milestone 5.1 - Farcaster Announcer Bot
- Create @letshaveaword Farcaster account (Done: https://farcaster.xyz/letshaveaword)
- Connect announcer bot signer
- Post round started announcements
- Post round resolved announcements
- Post milestone jackpot milestones
- Post milestone guess count milestones
- Post referral win announcements

### 📊 Milestone 5.2 - Analytics & Tracking
- Analytics table creation
- Event logging system:
  - `daily_open`, `free_guess`, `paid_guess`
  - `round_started`, `round_resolved`
  - `share_bonus_unlocked`
  - `referral_join`, `referral_win`
- Analytics views:
  - DAU/WAU metrics
  - Jackpot growth tracking
  - Free/paid guess ratios
- Admin analytics dashboard

### 🛡️ Milestone 5.3 - Anti-Abuse + Infrastructure
- **Anti-Abuse**
  - Enforce Neynar spam score filtering
  - Abuse detection and flagging system
  - Rate limiting for /guess endpoint
- **Infrastructure**
  - Caching layers (jackpot, wheel words, global guesses)
  - Daily reset cron job
  - Jackpot monitor cron job
  - Logging and error monitoring

### 📚 Milestone 5.4 - Round Archive
- Round summary fields on rounds table
- Historical round browsing
- Past winner showcase
- Archive UI and navigation

### ⛓️ Milestone 6.1 - Smart Contract Integration
- Smart contract development:
  - Paid guess escrow
  - Payout function
  - Purchase event handling
  - Creator withdrawal mechanism
- Contract testing and auditing
- Mainnet deployment

### 🎯 Milestone 6.2 - Optional / Future Enhancements
- Purchase web domain (http://letshaveaword.fun)
- Multi-wallet CLANKTON support
- XP system v2 with progression
- Leaderboard system
- Localization support
- Custom animations
- Achievement badges and unlockables

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

**Proprietary — All Rights Reserved**

Copyright © 2025 Jake Bouma (aka "starl3xx"). All rights reserved.

This software and all related materials are proprietary and confidential. No part of this software may be copied, modified, distributed, or used without explicit written permission from the copyright holder. See [LICENSE](LICENSE) file for full details.

For licensing inquiries, contact: starl3xx.mail@gmail.com or https://x.com/starl3xx

## Contributing

This is a proprietary project and contributions are not accepted at this time. The codebase is publicly visible for transparency and educational purposes only.

---

**Built with 🌠 by starl3xx**
