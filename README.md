# Let's Have A Word! 💬

**Massively multiplayer word hunt where everyone eliminates wrong answers until one player hits the ETH jackpot**

## Overview

**Let's Have A Word** is a Farcaster mini app where:
- **ONE** secret 5-letter word per round, shared globally
- Everyone in the world guesses the same word
- Wrong guesses appear on a spinning wheel for all to see
- The word only changes when someone guesses it correctly
- First correct guesser wins an ETH jackpot

## 🎯 Current Status: Milestone 4.7 Complete

All core game mechanics, onchain integration, social features, and UX polish are fully implemented and production-ready:

### ✅ Milestone 4.7 - Haptics Integration (Latest)

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

- **XP Display**
  - Integrated into Stats sheet
  - Shows current XP balance with large prominent display
  - "Coming Soon" messaging for future XP features
  - Lists planned features: progression, leaderboards, rewards, achievements
  - How to earn XP explanation

- **Navigation Buttons**
  - Three buttons below GUESS button: Stats, Refer, FAQ
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

- `GET /api/round-state` - Get current round status
  - Returns: `{ roundId, prizePoolEth, prizePoolUsd, globalGuessCount, lastUpdatedAt }`

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
- Share stats button opens native Farcaster composer

Stats displayed:
- **This Round**: Total guesses, paid guesses
- **All Time**: Total guesses, paid guesses
- **Jackpots**: Wins count, top 10 placements, referral wins, ETH earned breakdown
- **XP Display**: Current XP with large prominent styling
- **Coming Soon Section**: Future XP features and how XP is earned

**Referral Sheet (🤝)**
- Accessible via navigation button
- Shows personalized referral link
- Share button opens native Farcaster composer
- Copy button with haptic feedback
- Visual confirmation on copy

Referral data:
- Unique referral link with FID
- Total referrals count
- ETH earned from referrals
- "How it Works" explanation

**FAQ Sheet (🤔)**
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

### Navigation

**Bottom Navigation Grid**
- 3-button layout below GUESS button
- Icons + labels for clarity
- White background with borders
- Haptic feedback on tap
- Responsive grid layout

Buttons:
1. 📊 Stats - Personal statistics and XP display
2. 🤝 Refer - Referral program with share and copy
3. 🤔 FAQ - Help and comprehensive game info

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
├── GameKeyboard.tsx       # Custom on-screen keyboard (Milestone 4.4)
├── StatsSheet.tsx         # User statistics and XP sheet (Milestone 4.3)
├── ReferralSheet.tsx      # Referral link & stats (Milestone 4.3)
└── FAQSheet.tsx           # FAQ accordion (Milestone 4.3)

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
- **Milestone 5.1**: Announcer bot (automated round announcements)
- **Milestone 5.2**: ETH payment processing (actual payments)
- **Milestone 5.3**: Performance optimizations (caching, indexes)
- **Milestone 5.4**: Round archive (historical data browsing)
- **Milestone 5.5**: XP system and leaderboards
- **Milestone 5.6**: Achievement badges and unlockables

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
