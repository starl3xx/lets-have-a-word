# Let's Have A Word! 💬

**Massively multiplayer word hunt where everyone eliminates wrong answers until one player hits the ETH jackpot**

## Overview

**Let's Have A Word** is a Farcaster mini app where:
- **ONE** secret 5-letter word per round, shared globally
- Everyone in the world guesses the same word
- Wrong guesses appear on a spinning wheel for all to see
- The word only changes when someone guesses it correctly
- First correct guesser wins an ETH jackpot

---

## Changelog

### 2026-01-14 (after Round 7)

- **Word List Expansion**: Added 83 new words to CORE_COMMON, bringing total to 4,439 curated words
- **Purchase UX**: Added always-visible "+" icon (top right) with subtle shine animation; moved info icon to left
- **Social Proof**: Moved "X packs purchased" indicator to Round Archive modal as clickable pill
- **Wheel Fix**: Wheel now loads with all words as "unguessed" even when no active round (between rounds or during dead day)
- **Prize Pool Sync**: Fixed prize pool not syncing from contract on round creation; added admin sync endpoint
- **Admin Panel Enhancements**:
  - Added at-a-glance health badges (Game, Revenue, Retention, DAU) at top of Analytics
  - Added Live Round Dashboard with real-time prize pool, guesses, Top 10 progress bar
  - Added WAU trend chart alongside DAU with stickiness ratio indicator
  - Added Share & Referral Analytics section with channel breakdown and velocity chart
  - Added Retention & Cohorts section with return rate, churn metrics, user segments
  - Added Weekly Cohort Retention heatmap with color-coded retention percentages
  - Added Wallet Health Badge showing at-a-glance system status with issue detection
  - Created new API endpoints: `/api/admin/analytics/retention`, `/api/admin/analytics/cohorts`
- **Documentation**: Updated README, GAME_DOCUMENTATION, and CLAUDE.md with current word counts and architecture

---

## 🎯 Current Status: Milestone 13 Complete

All core game mechanics, onchain integration, social features, automated Farcaster announcements, analytics system, admin dashboard, fairness monitoring, anti-abuse systems, round archive, smart contract, CLANKTON oracle integration, UX/growth features, UI polish, push notifications, XP tracking, fully onchain prize distribution with tiered Top-10 payouts, rotating share templates, operational controls, economics dashboard, provably fair onchain commitment with public verification, production-hardened onchain pack purchases, OG Hunter prelaunch campaign, **and secure Quick Auth authentication to prevent FID spoofing** are fully implemented and production-ready:

### ✅ Milestone 13 - Security: Quick Auth Authentication (Latest)

Secure authentication using Farcaster Quick Auth to prevent FID spoofing attacks:

- **Quick Auth Integration** (`pages/index.tsx`, `pages/api/guess.ts`)
  - Uses `@farcaster/quick-auth` for JWT-based authentication
  - Client obtains token via `quickAuth.getToken()` from miniapp-sdk
  - Server verifies JWT and extracts FID from `sub` claim
  - Cryptographic proof that user owns the claimed FID

- **Security Fix: Block Unverified miniAppFid**
  - Previously, `miniAppFid` from SDK context was trusted without verification
  - Anyone could spoof requests with arbitrary FIDs
  - Now requires cryptographically signed Quick Auth JWT token
  - Unverified `miniAppFid` requests are rejected with 401

- **Authentication Flow**
  1. App loads, SDK provides user context with FID
  2. Client calls `quickAuth.getToken()` to get signed JWT
  3. JWT sent with guess requests as `authToken`
  4. Server verifies JWT via Quick Auth client
  5. FID extracted from verified JWT payload (`sub` field)
  6. Only verified FIDs can submit guesses

- **Backward Compatibility**
  - Dev mode still supports `devFid` for local testing
  - Frame requests (`frameMessage`) and signer UUID (`signerUuid`) still supported
  - Only mini app SDK context requires Quick Auth token

### ✅ Milestone 12 - OG Hunter Prelaunch & Mini App Enhancements

Prelaunch campaign system and enhanced Farcaster mini app integration:

- **OG Hunter Campaign** (`pages/splash.tsx`, `src/lib/og-hunter.ts`)
  - Prelaunch campaign where early users earn permanent badges
  - Users add the mini app + share a cast to qualify
  - 500 XP bonus for completing both actions
  - Immediate UI feedback when app is added locally
  - "Verified" badge after webhook confirmation
  - Database tables: `user_badges`, `og_hunter_cast_proofs`

- **Farcaster Mini App Embed Improvements**
  - Added `fc:miniapp` meta tag alongside `fc:frame` for better embed support
  - Share flows use `sdk.actions.composeCast()` with `embeds` parameter
  - Embeds auto-load in Farcaster clients (no manual space required)
  - External links use `sdk.actions.openUrl()` for proper in-app navigation

- **OG Hunter Badge Display** (`components/OgHunterBadge.tsx`)
  - Badge displayed in StatsSheet header for badge holders
  - Badge shown next to usernames in Top 10 early guessers list
  - `hasOgHunterBadge` field added to top-guessers API response
  - `useOgHunterBadge` hook for checking badge status

- **Admin Start Round Button** (`pages/admin/operations.tsx`, `pages/api/admin/operational/start-round.ts`)
  - Green "Start Round" card appears when no active round exists
  - One-click round creation from admin dashboard
  - Creates round with random word and onchain commitment
  - Triggers Farcaster announcement via @letshaveaword

- **Share Flow Improvements**
  - Share URLs simplified to `letshaveaword.fun` format
  - Removed redundant URLs from share copy (embeds provide the link)
  - Updated all share flows: winner, referral, stats, splash
  - Referral shares use unique referral link as embed

- **Database Migration** (`drizzle/0004_og_hunter.sql`)
  - `users.added_mini_app_at` column for tracking app additions
  - `user_badges` table for permanent achievement badges
  - `og_hunter_cast_proofs` table for cast verification

- **Environment Variables**
  - `NEXT_PUBLIC_PRELAUNCH_MODE` - Set to `1` for splash page, `0` for game
  - Existing: `ANNOUNCER_ENABLED`, `ANSWER_ENCRYPTION_KEY`

### ✅ Milestone 11 - Production Hardening & Onchain Pack Purchases

Production-hardened game operations with onchain pack purchases, comprehensive error handling, and enhanced admin tooling:

- **Onchain Pack Purchases** (`pages/api/purchase-guess-pack.ts`, `src/lib/pack-pricing.ts`)
  - Users sign transactions in wallet, frontend verifies onchain before awarding packs
  - Transaction verification via `verifyPurchaseTransaction()` prevents fraud
  - `txHash` tracking prevents double-claiming of the same transaction
  - Dynamic pricing phases: EARLY (0-849 guesses), MID (850-1249), LATE (1250+)
  - Pack purchase records stored in `pack_purchases` table with tx hash

- **Rate Limiting & Spam Protection** (`src/lib/rateLimit.ts`)
  - FID-first rate limiting with IP+UA fallback
  - Dual-window for guesses: burst (8/10s) + sustained (30/60s)
  - Separate limits for purchases (4/5min) and shares (6/60s)
  - Duplicate guess detection (10-second window)
  - Fail-open design: allows through if Redis unavailable

- **Share Verification via Neynar API** (`pages/api/share-callback.ts`)
  - Actually verifies cast exists on Farcaster before awarding bonus
  - Searches for cast mentioning `letshaveaword.fun` in last 10 minutes
  - Prevents gaming by opening composer without posting

- **CLANKTON Mid-Day Tier Upgrade** (`src/lib/clankton.ts`, `src/lib/daily-limits.ts`)
  - When market cap crosses $250K, holders get +1 guess (2→3)
  - Upgrade detected and applied mid-day, not just at daily reset
  - Market cap fetched from DexScreener with CoinGecko fallback

- **Leaderboard Lock at 850 Guesses** (`src/lib/top10-lock.ts`)
  - Top-10 rankings only count guesses 1-850 (was 750 for rounds 1-3)
  - Guesses 851+ count for winning but not for leaderboard
  - Prevents late-game clustering from skewing rankings

- **Comprehensive Error Handling** (`src/lib/appErrors.ts`)
  - Unified error system with 40+ error codes across categories
  - Categories: Network, Round State, Pricing, User, Guess, Share, Purchase, Wallet, Archive, Operational
  - Each error has user-facing title/body, CTA action, banner variant
  - Auto-retry configuration for transient errors

- **Contract State Diagnostics** (`pages/api/admin/operational/contract-state.ts`)
  - Real-time diagnostics for mainnet and Sepolia contracts
  - Detects balance < jackpot mismatches before resolution
  - Suggests recovery actions when issues detected
  - Clear Sepolia round action for emergency recovery

- **Force Resolve Admin Button** (`pages/api/admin/operational/force-resolve.ts`)
  - Admin can force-resolve stuck rounds via Operations tab
  - Submits correct answer as special admin user (FID 9999999)
  - Triggers normal round resolution flow
  - Logs timestamp and admin FID for audit trail

- **Sepolia Round Simulation** (`pages/api/admin/operational/simulate-round.ts`)
  - Full round lifecycle testing on Sepolia testnet
  - Creates fake users with random wallets
  - Generates wrong guesses with optional paid purchases
  - Auto-resolves previous round and auto-seeds if needed
  - DB-only fallback when onchain operations fail

- **Production Safety Checks**
  - Balance sufficiency check before resolution attempts
  - Contract state validation before withdrawal
  - Retry logic with exponential backoff for network errors
  - Graceful fallbacks when contract state mismatches detected

- **Bonus Guesses Tracking** (`src/lib/daily-limits.ts`)
  - Per-source tracking: base, CLANKTON, share, paid
  - Consumption order: free → CLANKTON → share → paid
  - `GuessSourceState` interface for detailed breakdown
  - API returns `sourceState` with remaining by source

- **Environment Variables**
  - `BASE_RPC_URL` - Mainnet RPC for transaction verification
  - `BASE_SEPOLIA_RPC_URL` - Sepolia RPC for simulation
  - `RATE_LIMIT_*` - Configurable rate limit thresholds

### ✅ Milestone 10 - Provably Fair Onchain Commitment

Enhanced provable fairness with onchain commitment and a public verification page:

- **Onchain Commitment** (`src/lib/jackpot-contract.ts`)
  - Each round's answer hash is written to the JackpotManager smart contract before guessing begins
  - Uses `startRoundWithCommitment(bytes32 commitHash)` to immutably record on Base
  - Commitment is timestamped and cannot be altered after round starts
  - New contract functions: `getCommitHash(roundNumber)`, `hasOnChainCommitment(roundNumber)`

- **Public Verification Page** (`pages/verify.tsx`)
  - Available at `/verify` for anyone to verify round fairness
  - Shows committed hash (database), onchain commitment (Base), revealed word, salt
  - Computes SHA256(salt + word) client-side and compares to committed hash
  - Deep linking support: `/verify?round=42` to verify specific rounds
  - Educational content explaining commit-reveal cryptography
  - Direct link to smart contract on BaseScan

- **Column-Level Encryption** (`src/lib/encryption.ts`)
  - Round answers encrypted at rest using AES-256-GCM
  - Key derived from `ANSWER_ENCRYPTION_KEY` environment variable
  - Format: `iv:authTag:ciphertext` (all hex-encoded)
  - Plaintext answer NEVER stored in database

- **Cryptographic Randomness** (`src/lib/word-lists.ts`)
  - Word selection uses `crypto.randomInt()` for unpredictable answers
  - Replaces `Math.random()` with cryptographically secure alternative

- **Updated Announcer Templates** (`src/lib/announcer.ts`)
  - Round start: Includes shortened hash and verify link
  - Round complete: Includes verify link, cleaner format
  - Jackpot milestones: 0.1/0.25/0.5 ETH (🔥) and 1.0 ETH (🚨) templates
  - Guess milestones: Now at 1K, 2K, 3K, 4K (was 100, 500, 1K, 5K, 10K)
  - Referral wins: Updated copy with direct link

- **Smart Contract Upgrade**
  - JackpotManager upgraded via UUPS proxy pattern
  - New implementation: `0x9166977F2096524eb5704830EEd40900Be9c51ee`
  - Proxy address: `0xfcb0D07a5BB5f004A1580D5Ae903E33c4A79EdB5`
  - Verified on BaseScan and Sourcify

- **Environment Configuration**
  - `ANSWER_ENCRYPTION_KEY` - 32-byte hex key for answer encryption (required)
  - Existing: `OPERATOR_PRIVATE_KEY` for contract interactions

### ✅ Milestone 9.6 - Economics Dashboard Enhancements

Enhanced the Economics tab with decision-oriented features for comparing metrics over time:

- **Target Evaluation Layer**
  - Static target ranges for key metrics (paid participation 8-25%, ETH/100 guesses 0.005-0.02, etc.)
  - "Below/Within/Above target" badges on scorecard tiles
  - Delta display showing distance from target range
  - Target-aware guidance recommendations ("Below target in 7 of last 10 rounds")

- **Prize Pool Growth Curve Chart**
  - SVG chart showing cumulative pool ETH vs guess index
  - Median line with P25-P75 shaded envelope
  - 750 cutoff vertical annotation line
  - Auto-interpretation of growth pattern (early-heavy, balanced, late-heavy)

- **Per-Round Economics Config Snapshots** (`src/db/schema.ts`, `migrations/0010_economics_config_snapshots.sql`)
  - New `round_economics_config` table stores config per round
  - Captures: top-10 cutoff, pricing thresholds/prices, pool split params
  - Config change detection for historical comparison

- **Compare Mode**
  - Dropdown selector: "Last 10 vs Previous 10 rounds" or "Since config change"
  - Side-by-side comparison showing paid participation, ETH/100 guesses, rounds ending before 750
  - Delta indicators with positive/negative styling

### ✅ Milestone 9.5 - Kill Switch & Dead Day Operational Controls

Added operational controls for emergency situations and planned maintenance:

- **Unified Admin Dashboard** (`pages/admin/index.tsx`)
  - Single page at `/admin` with tabbed interface
  - Four tabs: Operations, Analytics, Round Archive, Economics
  - URL query param navigation (`?tab=operations|analytics|archive|economics`)
  - Persistent status strip showing operational state
  - Keyboard shortcuts (1/2/3/4) for tab switching

- **Kill Switch** (`pages/api/admin/operational/kill-switch.ts`)
  - Emergency stop for active rounds
  - Cancels current round and prevents new rounds from starting
  - Requires reason for audit trail
  - Triggers automatic refund process for cancelled rounds

- **Dead Day Mode** (`pages/api/admin/operational/dead-day.ts`)
  - Planned maintenance mode - no new rounds start
  - Current round continues to completion
  - Visual indicators in Operations tab

- **Refund System** (`pages/api/admin/operational/refunds.ts`, `pages/api/cron/process-refunds.ts`)
  - Automatic refund processing for cancelled rounds
  - Tracks refund status: pending → processing → sent/failed
  - Per-user refund aggregation from pack purchases
  - Cron job for batch processing

- **Operations Dashboard** (`components/admin/OperationsSection.tsx`)
  - Real-time operational status display
  - Kill switch and dead day toggle controls
  - Refund progress tracking
  - Audit log of operational events

- **Database Schema Updates** (`src/db/schema.ts`)
  - `pack_purchases` table for tracking individual purchases
  - `refunds` table for refund tracking
  - `operational_events` table for audit logging
  - Round status field: `active` | `resolved` | `cancelled`

### ✅ Milestone 8.1 - Rotating Share Copy Templates

Added variety to share prompts with rotating copy templates for incorrect guesses:

- **Share Templates** (`src/lib/shareTemplates.ts`)
  - 9 unique share copy templates with personality and urgency
  - Uses `{WORD}` and `{JACKPOT}` placeholders for dynamic content
  - Random template selected on modal mount (stable during session)
  - All templates include game URL and emojis

- **SharePromptModal Updates** (`components/SharePromptModal.tsx`)
  - Fetches current prize pool from `/api/round-state` on mount
  - Uses `useMemo` for stable random template selection
  - Removed preview section for cleaner modal
  - Simplified footer: "Share bonus can only be earned once per day"

### ✅ Milestone 7.x - UI/UX Refinements

Polished user interface with improved transitions, typography, and visual consistency:

- **Archive Page Redesign** (`pages/archive/index.tsx`)
  - Restyled to match RoundArchiveModal design
  - Uses Söhne font family for consistency with admin pages
  - Replaced inline styles with Tailwind classes
  - StatChip components with pill-style badges
  - Clean rounded-2xl cards and modern button styling

- **Incorrect Guess Banner Timing** (`pages/index.tsx`, `components/ResultBanner.tsx`)
  - Four-phase state machine: `none` | `active` | `faded` | `fading_out`
  - Red state: 1.5s active duration
  - Red-to-gray transition: 1s smooth color fade
  - Gray state: 1.5s faded duration
  - Fade out: 1s opacity transition to transparent
  - Clears result on dismiss to prevent banner reverting to red

- **GuessPurchaseModal Refinements** (`components/GuessPurchaseModal.tsx`)
  - Moved pricing state label before pack options
  - De-emphasized purchase limit indicator (smaller, muted text)
  - Added reassurance microcopy: "Purchases contribute to the prize pool"
  - Changed CTA from "Buy pack(s)" to "Buy guesses"
  - Shows "Late round pricing (max)" for LATE_2 phase (1250+ guesses)

- **Dev Mode Pricing Consistency** (`pages/api/guess-pack-pricing.ts`)
  - Fixed inconsistency between TopTicker and GuessPurchaseModal in dev mode
  - Pricing API now uses `getDevRoundStatus()` for cached random values
  - Ensures consistent display values across all UI components

- **ResultBanner Color Transitions** (`components/ResultBanner.tsx`)
  - Smooth CSS transitions for border-color, background-color, and text color
  - Faded state uses gray styling instead of red
  - Configurable transition durations via inline styles

### ✅ Milestone 6.9b - Tiered Top-10 Guesser Payouts

Implemented fixed-percentage distribution for Top-10 guessers, replacing equal splits with a rank-based allocation:

- **Tiered Distribution** (`src/lib/top-guesser-payouts.ts`)
  - Rank 1: 19% of Top-10 pool
  - Rank 2: 16%
  - Rank 3: 14%
  - Rank 4: 11%
  - Rank 5: 10%
  - Ranks 6–10: 6% each
  - Total: 100% (10000 basis points)

- **Adaptive N < 10 Handling**
  - Uses first N ranks from distribution
  - Renormalizes percentages to sum to 100%
  - Preserves rank ordering (shape maintained)
  - Dust assigned to rank #1

- **Precision & Safety**
  - All math in wei using BigInt
  - Division rounds down (never overpays)
  - Comprehensive validation (no duplicates, valid addresses)
  - 26 acceptance tests

- **Canonical Economics Spec** (`docs/LHAW_canonical_economics.md`)
  - Single source of truth for all prize distribution rules
  - Covers 80/10/10 split, referral logic, Top-10 tiers
  - Design rationale and implementation references

### ✅ Milestone 6.9 - Onchain Multi-Recipient Prize Distribution

Upgraded smart contract to distribute all prizes atomically in a single transaction:

- **Smart Contract Upgrade** (`contracts/src/JackpotManager.sol`)
  - New `resolveRoundWithPayouts(recipients[], amounts[], seedForNextRound)` function
  - Pays winner, referrer, and all Top-10 guessers in one atomic transaction
  - New events: `RoundResolvedWithPayouts`, `PayoutSent`
  - New errors: `ArrayLengthMismatch`, `PayoutsExceedJackpot`, `TooManyRecipients`
  - CEI pattern for reentrancy safety, max 20 recipients

- **Backend Integration** (`src/lib/economics.ts`, `src/lib/jackpot-contract.ts`)
  - `resolveRoundWithPayoutsOnChain()` calls new contract function
  - Backend calculates amounts, contract enforces execution
  - All payouts verifiable on BaseScan

- **Prize Distribution Logic**
  - Winner always receives 80%
  - Top-10 always receives 10% (weighted by rank)
  - With referrer: 5% referrer, 5% seed (capped at 0.03 ETH, overflow → creator)
  - Without referrer: 12.5% Top-10 guessers, 7.5% seed
  - Self-referral blocked at signup

- **No Offchain Payouts**
  - All prize money distributed onchain
  - No manual intervention or backend reconciliation
  - Trust-minimized, fully transparent

### ✅ Milestone 6.7.1 - Incorrect Guess Banner Flow + Input Reset

Improved UX after incorrect guesses with a timed state machine that transitions from active error to faded context:

- **Incorrect State Machine** (`pages/index.tsx`)
  - Three states: `none` | `active` | `faded`
  - `active`: Bright red error banner, input boxes red and locked
  - `faded`: Gray semi-transparent banner showing last guess, input ready for new guess
  - Configurable duration: `INCORRECT_ACTIVE_DURATION_MS = 2000` (2 seconds)

- **Banner Transitions** (`components/ResultBanner.tsx`)
  - Added `faded` prop for gray/semi-transparent state
  - Faded banner shows context: "Incorrect! WORD is not the secret word."
  - Smooth opacity transition (0.7 opacity in faded state)
  - Gray icon replaces red X in faded state

- **Input Box Behavior**
  - During `active`: Red borders, empty, visually locked
  - During `faded`: Normal neutral state, ready for new input
  - Typing clears incorrect state and cancels timer

- **Out of Guesses Handling**
  - If no guesses remain, skip faded state entirely
  - Show "No guesses left today" banner instead
  - Input boxes remain locked/disabled

- **Timer Management**
  - Automatic cleanup on unmount
  - Cancel timer when user starts typing
  - Multiple incorrect guesses in a row work correctly (no overlapping timers)

### ✅ Milestone 6.7 - XP System (Tracking-First Implementation)

Introduced a comprehensive XP tracking system with event-sourced backend and Total XP display in Stats sheet:

- **Event-Sourced XP Model** (`src/db/schema.ts`, `drizzle/0003_xp_events.sql`)
  - New `xp_events` table stores all XP-earning actions
  - Future-proof design: breakdown by source, streaks, leaderboards can be added without schema changes
  - Indexes on fid, round_id, and event_type for fast queries

- **XP Event Types** (`src/types/index.ts`)
  - `DAILY_PARTICIPATION` (+10 XP) — First guess of the day
  - `GUESS` (+2 XP) — Each valid guess
  - `WIN` (+2,500 XP) — Winning the jackpot
  - `TOP_TEN_GUESSER` (+50 XP) — Top 10 placement at round resolution
  - `REFERRAL_FIRST_GUESS` (+20 XP) — Referred user makes first guess
  - `STREAK_DAY` (+15 XP) — Consecutive day playing
  - `CLANKTON_BONUS_DAY` (+10 XP) — CLANKTON holder daily bonus
  - `SHARE_CAST` (+15 XP) — Sharing to Farcaster
  - `PACK_PURCHASE` (+20 XP) — Buying a guess pack
  - `NEAR_MISS` (0 XP) — Tracked for future use

- **XP Helper Functions** (`src/lib/xp.ts`)
  - Fire-and-forget XP logging (never blocks user flows)
  - `getTotalXpForFid()` — Sum of all XP for a user
  - `getRecentXpEventsForFid()` — Last N events for debugging
  - `getXpBreakdownForFid()` — XP by event type
  - Streak detection, referral attribution, near-miss tracking

- **Integration Points**
  - Guess submission (`src/lib/daily-limits.ts`)
  - Round resolution (`src/lib/economics.ts`)
  - Pack purchase (`pages/api/purchase-guess-pack.ts`)
  - Share bonus (`src/lib/daily-limits.ts`)

- **API Endpoints**
  - `GET /api/user/xp` — Returns total XP (+ breakdown in dev mode)
  - `GET /api/admin/xp-debug` — Dev-only comprehensive XP debugging

- **UI Changes** (`components/StatsSheet.tsx`)
  - Total XP displayed prominently in Stats sheet
  - Updated "How to earn XP" section with actual XP values
  - XP fetched from new event-sourced endpoint

- **Dev Mode Support**
  - `XP_DEBUG=true` enables verbose XP logging
  - Dev-only `/api/admin/xp-debug` endpoint
  - XP breakdown and recent events in `/api/user/xp` response

### ✅ Milestone 6.6 - Push Notifications & Bug Fixes

Added Farcaster mini app notifications support and fixed critical duplicate guess bug:

- **Farcaster Manifest** (`public/.well-known/farcaster.json`)
  - Frame metadata for mini app discovery
  - Neynar webhook URL for notification token management
  - Icon and splash screen configuration

- **Mini App Add Prompt** (`components/FirstTimeOverlay.tsx`)
  - First-time users prompted to add app to Farcaster
  - Uses `sdk.actions.addFrame()` from `@farcaster/miniapp-sdk`
  - Primary CTA: "Add to Farcaster" with "Skip for now" option
  - Enables push notifications for new rounds
  - Auto-dismisses on success with haptic feedback

- **Duplicate Guess Bug Fix** (`src/lib/daily-limits.ts`)
  - **Bug**: Credits were consumed BEFORE validation, causing duplicate guesses to incorrectly decrement free/paid guess counter
  - **Fix**: Validate guess FIRST, only consume credit if result is `correct` or `incorrect`
  - Rejected guesses (`already_guessed_word`, `invalid_word`, `round_closed`) no longer consume credits
  - Added comprehensive test suite for credit protection

- **Incorrect Guess Banner Update** (`pages/index.tsx`)
  - New copy: "Incorrect! **WORD** is not the secret word."
  - Word displayed in bold red (same color as banner text)
  - Removed X icon from incorrect banner
  - No guess count shown in banner

- **Already Guessed Banner Update**
  - Changed from yellow warning to red error variant
  - Simplified message: "Already guessed this round"

### ✅ Milestone 6.4.7 - Dev Mode Persona Switcher

Added a client-side persona switcher for QA testing different user states without modifying the database:

- **Dev Persona Panel**: Slide-out drawer for selecting test personas
- **Persona Button**: "DEV" pill in top-right (pulsing "DEV*" when override active)
- **7 Predefined Personas**:
  - Real State (no overrides)
  - New Non-Holder (1 free guess, share available)
  - Engaged Non-Holder (share bonus available, no guesses)
  - Non-Holder Out of Guesses (share used, no guesses)
  - CLANKTON Holder Low Tier (+2 bonus guesses)
  - CLANKTON Holder High Tier (+3 bonus guesses)
  - Maxed-Out Buyer (max packs, share used, no guesses)
- **Reset Button**: Clear overrides and return to real API state
- **Environment**: Only visible when `NEXT_PUBLIC_LHAW_DEV_MODE=true`

### ✅ Milestone 6.4.6 - First Input Lag Optimization

Optimized first keystroke response for instant feedback:

- **Fast Path Handling**: Bypass hook overhead for common input cases
- **Skip Redundant State Updates**: Only call setters when values change
- **Targeted CSS Transitions**: Only animate border-color and box-shadow
- **Deferred Wheel Updates**: Use `requestIdleCallback` for wheel positioning

### ✅ Milestone 6.4.5 - Wheel Jump UX: Uniform Perceived Speed

Fixed the "big jump feels slower" issue where large letter jumps (D→R) felt heavier than small jumps (D→E):

- **Two-Mode Animation** based on row distance:
  - **Small Jumps** (≤10 rows): Smooth scroll with fixed 150ms duration
  - **Large Jumps** (>10 rows): "Teleport + Settle" - instant snap near target, then animate final 3 rows

- **Teleport + Settle Approach**:
  - Instantly snap to 3 rows before target (no visible long scroll)
  - Animate the final 3 rows with same 150ms duration
  - User never sees "train ride" scroll - just quick snap + small settle

- **Uniform Perceived Speed**:
  - Typing "ABOUT" (A-words, small jump) feels same as "READY" (R-words, large jump)
  - All visible animations use fixed 150ms duration
  - No more distance-based duration scaling

- **Accessibility**: Respects `prefers-reduced-motion` - snaps instantly if enabled

- **Configuration** (`components/Wheel.tsx`):
  - `JUMP_THRESHOLD = 10` rows
  - `SETTLE_ROWS = 3` rows
  - `ANIMATION_DURATION_UNIFORM = 150` ms

### ✅ Milestone 6.4.4 - Unified Result Banner System

Replaced ad-hoc result banners with a unified, consistent ResultBanner component:

- **ResultBanner Component** (`components/ResultBanner.tsx`)
  - Three variants: `error`, `warning`, `success`
  - Consistent layout across all banner types
  - Theme-appropriate colors (red/amber/green)
  - SVG icons for error/warning, emoji (🎉) for success
  - Accessibility: `role="status"` and `aria-live="polite"`

- **Banner Messages Updated**
  - Incorrect: "Incorrect. You've made N guess(es) this round." (error)
  - Already guessed: "Already guessed this round." (warning)
  - Not a valid word: "Not a valid word" (warning)
  - Winner: "Correct! You found the word \"[WORD]\" and won this round!" (success)

- **No Emojis for Error/Warning**
  - Error uses red X icon
  - Warning uses amber triangle icon
  - Only success banner keeps 🎉 emoji

### ✅ Milestone 6.4.3 - Input & Word Wheel Performance Audit

Comprehensive performance audit and optimization pass to make the guessing experience feel instant and "buttery smooth" on every device:

- **Memoized Input Boxes**
  - Individual letter boxes wrapped in `React.memo` (`GuessSlot` component)
  - Each slot only re-renders when its own props change
  - Eliminates "gray then black" flicker on first input box
  - Visual state computed once per render, not per-slot
  - Component: `LetterBoxes.tsx` (updated)

- **Performance Debugging Tools**
  - New utility: `src/lib/perf-debug.ts`
  - Enable via `NEXT_PUBLIC_PERF_DEBUG=true`
  - Measures keydown-to-paint timing for input boxes
  - Measures keydown-to-wheel-animation timing
  - `ExtremeJumpTests` constants for A↔Z rotation testing
  - `devLog()` / `perfLog()` utilities for gated console output

- **Wheel Component Optimizations**
  - Console.log statements gated behind dev mode checks
  - Performance logs only appear when PERF_DEBUG enabled
  - Animation timing logged for debugging wheel responsiveness
  - Component: `Wheel.tsx` (updated)

- **Verified Behaviors**
  - Tap/focus rules preserved: empty row focuses first box, partial/full rows ignore taps
  - Dev mode wheel start index changes on every refresh (for testing)
  - Production wheel start index stable per-day-per-user

### ✅ Milestone 6.4 - UI Polish & Interaction Refinements

Improved core game feel and responsiveness with focus on input behavior and animation performance:

- **Guess Input Row - Tap/Focus Logic**
  - Centralized state machine in `useGuessInput` hook
  - Empty row: tapping any box focuses first box; typing fills left-to-right
  - Partial/full row: tapping does nothing; typing appends; backspace deletes from right
  - Error/red state: all taps and input ignored until state resets
  - Out of guesses: input disabled with visual feedback (lowered opacity, cursor changes)
  - Submitting: input locked during API call
  - Consistent behavior across desktop, mobile Safari/Chrome, and Farcaster mini-app
  - Hook: `src/hooks/useGuessInput.ts`
  - Components: `LetterBoxes.tsx`, `pages/index.tsx` (updated)

- **Stats Sheet Copy**
  - Button text changed to sentence case: "Share my stats"
  - Wired through i18n layer: `t('stats.shareButton')`
  - Locale: `locales/en.json` (updated)
  - Component: `StatsSheet.tsx` (updated)

- **Word Wheel Animation - Performance Tuning**
  - Reduced CSS transition duration: 200ms (was 300ms)
  - Custom scroll animation with capped duration (100-250ms)
  - Animation cap ensures A→Z feels same speed as C→D
  - Added `will-change: transform, opacity` for GPU acceleration
  - Uses `requestAnimationFrame` with easeOutCubic easing
  - Debug mode: set `NEXT_PUBLIC_WHEEL_ANIMATION_DEBUG_SLOW=true` to slow animations 3x
  - Config: `config/economy.ts` (WHEEL_ANIMATION_CONFIG)
  - Component: `Wheel.tsx` (updated)

### ✅ Milestone 6.3 - UX, Growth, Guess Packs, Referrals, Share Flow

Comprehensive UX and growth mechanics for pre-production readiness:

- **Guess Pack Purchase Flow**
  - Users can purchase 1, 2, or 3 packs per day (3 guesses per pack)
  - Max 9 paid guesses per day
  - Dynamic pricing from smart contract or environment variable
  - Purchase tracking per UTC day
  - Components: `GuessPurchaseModal.tsx`
  - API: `POST /api/purchase-guess-pack`, `GET /api/guess-pack-pricing`

- **Share-for-Free-Guess Flow (Farcaster Only)**
  - One free guess per day for sharing to Farcaster
  - Auto-populated share text with game link
  - Only Farcaster users (via Neynar SIWN) eligible
  - Components: `SharePromptModal.tsx` (updated)

- **"Want Another Guess?" Popup**
  - Random interjection from internationalized list (25 options)
  - Options: Share for free guess OR Buy guess packs
  - Components: `AnotherGuessModal.tsx`

- **Referral UX Polish**
  - Auto-copy referral link when opening modal (optional toggle)
  - Animated ETH earned counter
  - Enhanced haptics for copy/share actions
  - Analytics events: `REFERRAL_MODAL_OPENED`, `REFERRAL_LINK_COPIED`, `REFERRAL_SHARE_CLICKED`
  - Components: `ReferralSheet.tsx` (updated)

- **Stats Page Enhancements**
  - Guesses per round histogram (last 10 rounds)
  - Median guesses to solve (for won rounds)
  - Free vs bonus vs paid guesses breakdown
  - Referrals generated this round
  - Components: `StatsSheet.tsx` (updated)
  - API: `GET /api/user/stats` (extended)

- **Share Card Polish**
  - Brand color palette (purple gradient)
  - CLANKTON mascot for token holders
  - Jackpot amount display
  - Round number badge
  - Text anti-aliasing
  - Components: `WinnerShareCard.tsx` (updated)

- **Localization Scaffolding**
  - Locale files: `/locales/en.json`, `/locales/base.json`
  - Translation hook: `useTranslation()` with `t()` function
  - Supports variable interpolation (`{{variable}}`)
  - Browser language detection with English fallback
  - All new UI strings wrapped in translation keys

- **Micro-Interaction Haptics**
  - Pack purchased: success notification
  - Link copied: medium impact
  - Share completed: success notification
  - Card saved: medium impact
  - Module: `src/lib/haptics.ts` (extended)

- **Daily Guess Flow Modal Decision Logic**
  - Smart modal sequencing based on user state
  - Session-level tracking to avoid repeat modal spam
  - Decision tree: share modal → pack modal → out-of-guesses
  - Hook: `useModalDecision` in `src/hooks/useModalDecision.ts`
  - Exported types: `ModalDecision`, `ModalDecisionState`, `ModalDecisionParams`

- **Analytics Events**
  - Guess Pack: `GUESS_PACK_VIEWED`, `GUESS_PACK_PURCHASED`, `GUESS_PACK_USED`
  - Share: `SHARE_PROMPT_SHOWN`, `SHARE_CLICKED`, `SHARE_SUCCESS`
  - Referral: `REFERRAL_MODAL_OPENED`, `REFERRAL_LINK_COPIED`, `REFERRAL_SHARE_CLICKED`
  - Module: `src/lib/analytics.ts` (extended)

### ✅ Milestone 5.4 - Round Archive

Comprehensive round archive system for storing and browsing historical round data:

- **Database Schema**
  - New `round_archive` table for archived round data
  - Fields: roundNumber, targetWord, seedEth, finalJackpotEth, totalGuesses, uniquePlayers, winnerFid, winnerCastHash, winnerGuessNumber, startTime, endTime, referrerFid, payoutsJson, salt, clanktonBonusCount, referralBonusCount
  - Index on `round_number` for fast lookups
  - New `round_archive_errors` table for tracking archive anomalies
  - Migration: `drizzle/0002_round_archive.sql`

- **Backend Logic**
  - `archiveRound()` function computes and stores round statistics
  - Idempotent - safe to call multiple times
  - Computes: totalGuesses, uniquePlayers, CLANKTON bonus count, referral signups
  - Attaches payout JSON with winner, referrer, top guessers, seed, creator
  - Module: `src/lib/archive.ts`

- **Public API Endpoints**
  - `GET /api/archive/latest` - Most recently archived round
  - `GET /api/archive/:roundNumber` - Specific round with optional distribution histogram
  - `GET /api/archive/list` - Paginated list with optional aggregate stats

- **Admin API Endpoints**
  - `POST /api/admin/archive/sync` - Archive all unarchived resolved rounds
  - `GET /api/admin/archive/debug/:roundNumber` - Compare archived vs raw data
  - `GET /api/admin/archive/errors` - View archiving errors

- **Admin Dashboard**
  - New `/admin/archive` page with full archive management
  - Statistics overview: total rounds, guesses, unique winners, jackpot distributed
  - Paginated round table with click-to-detail
  - Detail view: winner info, payouts breakdown, guess distribution histogram
  - Sync controls and error monitoring

- **Player UI**
  - `/archive` - Browse all archived rounds with pagination
  - `/archive/:roundNumber` - Individual round detail page
  - Displays: word, jackpot, winner, guesses, players, duration
  - Guess distribution histogram by hour
  - Commit-reveal verification info (salt)
  - Responsive dark theme matching game UI

- **Error Handling**
  - Archive errors stored in `round_archive_errors` table
  - Debug endpoint compares archived vs raw data
  - Discrepancy detection and reporting

### ✅ Milestone 5.3 - Advanced Analytics & Fairness Systems

Comprehensive game integrity protections, adversarial simulations, and provable-fairness monitoring:

- **Continuous Fairness Monitoring**
  - Validates every commit-reveal pair across all rounds
  - Detects hash mismatches between committed and revealed solutions
  - Automated alerts for suspicious patterns
  - Module: `src/services/fairness-monitor/index.ts`

- **Transaction-Level Prize Audit**
  - Cross-checks prize amounts vs expected economic rules (80/10/10 split)
  - Detects underpayment, overpayment, or anomalies
  - Tracks seed cap compliance (0.03 ETH max)
  - Module: `src/services/fairness-monitor/prize-audit.ts`

- **User Quality Gating (Anti-Bot)**
  - Requires Neynar User Score ≥ 0.55 to submit guesses
  - Threshold lowered from 0.6 to 0.55 in Jan 2025 to expand eligibility
  - 24-hour score caching with automatic refresh
  - Blocks low-quality/bot accounts from gameplay
  - Module: `src/lib/user-quality.ts`

- **Adversarial Simulation Engine**
  - `wallet_clustering` - Detects sybil attacks (shared wallets, referral chains)
  - `rapid_winner` - Models improbable win streaks
  - `frontrun_risk` - Assesses attack vectors against commit-reveal
  - `jackpot_runway` - Projects prize pool sustainability under stress
  - `full_suite` - Runs all simulations with combined report
  - Module: `src/services/simulation-engine/index.ts`

- **Enhanced Analytics Dashboard**
  - Fairness & Integrity section with alert monitoring
  - User Quality Gating metrics (eligible/blocked users)
  - CLANKTON holder solve-rate advantage analysis
  - Referral performance tracking (guesses, wins, payouts)
  - Guess distribution histogram
  - Simulation controls and results viewer

- **New Analytics Events**
  - Fairness: `FAIRNESS_ALERT_HASH_MISMATCH`, `FAIRNESS_ALERT_PAYOUT_MISMATCH`
  - Simulations: `SIM_STARTED`, `SIM_COMPLETED`, `CLUSTER_ALERT`, `RAPID_FIRE_ALERT`
  - User Quality: `USER_QUALITY_BLOCKED`, `USER_QUALITY_REFRESHED`
  - Paid Guesses: `GUESS_PACK_USED` (with credits_remaining, round_id, fid)
  - Sharing: `SHARE_SUCCESS` (with cast hash)

- **New API Endpoints**
  - `GET/POST /api/admin/analytics/fairness` - Fairness dashboard and audits
  - `POST /api/admin/analytics/simulations` - Run adversarial simulations
  - `GET /api/admin/analytics/performance` - CLANKTON advantage & referral metrics
  - `POST /api/admin/analytics/export` - CSV/JSON data export

- **Database Schema Updates**
  - Added `user_score` (DECIMAL 5,3) to users table
  - Added `user_score_updated_at` (TIMESTAMP) for cache management
  - Index on `user_score_updated_at` for efficient queries

- **Configuration**
  - `USER_QUALITY_GATING_ENABLED=true` - Enable anti-bot protection
  - Quality threshold: 0.55 (configurable in code)
  - Score cache duration: 24 hours

### ✅ Milestone 5.2 - Analytics System + SIWN Web Admin Login

Comprehensive analytics tracking and web-based admin dashboard with Neynar SIWN authentication:

- **Analytics Event Logging**
  - Fire-and-forget design (never blocks user flows)
  - Feature-flagged via `ANALYTICS_ENABLED` env var
  - Tracks user activity, referrals, and round events
  - Event types: `daily_open`, `free_guess_used`, `paid_guess_used`, `referral_join`, `referral_win`, `share_bonus_unlocked`, `round_started`, `round_resolved`
  - Stored in `analytics_events` table with JSONB data payloads
  - Optional debug logging via `ANALYTICS_DEBUG`

- **Analytics Views & Metrics**
  - `view_dau` - Daily Active Users
  - `view_wau` - Weekly Active Users (ISO week)
  - `view_free_paid_ratio` - Free vs paid guess breakdown
  - `view_jackpot_growth` - Prize pool evolution
  - `view_referral_funnel` - Referral shares → joins → wins → bonuses

- **Web Admin Dashboard**
  - URL: `/admin/analytics` (web-only, not in mini app)
  - Neynar SIWN authentication
  - Access restricted to FIDs in `LHAW_ADMIN_USER_IDS`
  - Tabs: DAU, WAU, Free/Paid Ratio, Jackpot Growth, Referral Funnel, Raw Events
  - Simple table displays with expandable JSON for raw events
  - Pagination support for event log

- **API Endpoints**
  - `GET /api/admin/me` - Check admin status
  - `GET /api/admin/analytics/dau` - DAU data
  - `GET /api/admin/analytics/wau` - WAU data
  - `GET /api/admin/analytics/free-paid` - Free/paid ratio
  - `GET /api/admin/analytics/jackpot` - Jackpot growth
  - `GET /api/admin/analytics/referral` - Referral funnel
  - `GET /api/admin/analytics/events` - Raw events (paginated)
  - All endpoints enforce admin FID check

- **Integration Points**
  - `src/lib/rounds.ts` - Round started/resolved events
  - `src/lib/guesses.ts` - Guess events (free/paid, correct/incorrect)
  - `src/lib/users.ts` - Referral join events
  - `src/lib/daily-limits.ts` - Share bonus unlocked events

- **Configuration**
  - `ANALYTICS_ENABLED=true` - Master on/off switch
  - `ANALYTICS_DEBUG=true` - Verbose logging (optional)
  - `LHAW_ADMIN_USER_IDS=6500,1477413` - Comma-separated admin FIDs
  - `NEXT_PUBLIC_NEYNAR_CLIENT_ID` - Neynar client ID (public)
  - `NEYNAR_API_KEY` - Neynar API key (server-side)
  - Neynar app: Authorized origin `https://lets-have-a-word.vercel.app`
  - Permissions: Read + Write (Write required for SIWN)

### ✅ Milestone 5.1 - Farcaster Announcer Bot

Automated Farcaster announcements for round updates, milestones, and jackpot notifications from @letshaveaword (FID 1477413):

- **Announcer Bot**
  - Posts from official @letshaveaword Farcaster account (FID 1477413)
  - Uses Neynar signer infrastructure (UUID: 75a966ee-fcd5-4c04-a29f-a5d8cc646902)
  - Completely disabled in dev mode (NODE_ENV !== 'production')
  - Safe, idempotent, and rate-limited
  - All announcements are de-duplicated via announcer_events table

- **Announcement Types**
  1. **Round Started** - Posted when a new round is created
     - Displays round number and starting prize pool
     - Shows shortened commitment hash (first 10 + last 4 chars)
     - Links to `/verify?round=N` for verification
     - Confirms word is "locked onchain"
  2. **Round Resolved** - Posted when someone wins the jackpot
     - Shows winning word, jackpot amount, winner mention
     - Displays top 10 early guessers with payout split
     - Links to `/verify?round=N` for verification
     - Notes referrer earnings inline (if applicable)
     - "New round starts soon" teaser
  3. **Jackpot Milestones** - Posted when prize pool crosses thresholds
     - 0.1, 0.25, 0.5 ETH: 🔥 template ("One secret word. One winner.")
     - 1.0 ETH: 🚨 urgent template ("is getting serious")
     - Includes USD estimate
  4. **Guess Milestones** - Posted at 1K, 2K, 3K, 4K guesses
     - "Every wrong guess removes one word from the shared global pool"
     - Direct link to game
  5. **Referral Win** - Posted when a winner had a referrer
     - Highlights referrer earnings
     - "Share your link. You can win even when your friends do"
     - Threaded as reply to round resolved announcement

- **Database Schema**
  - New `announcer_events` table for event tracking
  - Fields: eventType, roundId, milestoneKey, payload, castHash, postedAt
  - Unique constraint on (eventType, roundId, milestoneKey) for idempotency
  - Prevents duplicate announcements

- **Environment Configuration**
  - `NEYNAR_API_KEY` - Neynar API key (required)
  - `NEYNAR_SIGNER_UUID` - Signer UUID for announcer account (75a966ee-fcd5-4c04-a29f-a5d8cc646902)
  - `ANNOUNCER_FID` - FID of announcer account (1477413)
  - `ANNOUNCER_ENABLED` - Feature flag (must be 'true' in production)
  - `ANNOUNCER_DEBUG_LOGS` - Optional verbose logging (default: false)
  - `NODE_ENV` - Must be 'production' for announcer to post

- **Dev Mode Safety**
  - Hard-coded checks prevent ANY announcements when NODE_ENV !== 'production'
  - Dev mode logs skipped announcements for debugging
  - No risk of accidental dev/staging posts to production account

- **Integration Points**
  - `src/lib/rounds.ts` - Round creation announcements
  - `src/lib/economics.ts` - Round resolution and referral announcements
  - `src/lib/guesses.ts` - Jackpot and guess milestone announcements
  - All announcer calls are non-blocking (wrapped in try-catch)
  - Announcer failures never break core game functionality

- **Implementation Details**
  - Module: `src/lib/announcer.ts`
  - Helper: `recordAndCastAnnouncerEvent()` for idempotent posting
  - Functions: `announceRoundStarted()`, `announceRoundResolved()`, `checkAndAnnounceJackpotMilestones()`, `checkAndAnnounceGuessMilestones()`, `announceReferralWin()`
  - Graceful error handling throughout
  - Comprehensive logging for monitoring

### ✅ Milestone 4.14 - UI Polish + Dev Mode Enhancements

Comprehensive UI/UX improvements and dev mode features for better visual feedback and testing:

- **Word Wheel Focus Color Rules**
  - Wheel words: unguessed → black, wrong → red, winner → gold
  - Focus word (above input): black when valid & unguessed, red when already guessed
  - Input boxes: blue border for valid words, red border for already guessed
  - Guess submission blocked for already-guessed words

- **Fixed-Height Error Container**
  - Error messages toggle opacity only (no layout shifts)
  - Fixed 3.5rem height container under input boxes
  - Smooth fade transitions (300ms)
  - Wheel container height remains stable

- **Per-User Per-Day Random Wheel Start Position**
  - Random start index generated once per day per user (11:00 UTC reset)
  - Stored server-side in `dailyGuessState` table
  - Tied to FID for personalized wheel position
  - Optional per-round reset support
  - Not recomputed on page refresh

- **Winner UX Enhancement**
  - Full-screen confetti animation (3 seconds, green colors)
  - Winning word remains visible in input boxes
  - Green pulse-glow animation on input boxes
  - Winner share card with Farcaster + X (Twitter) options
  - Share text: "I just hit the ETH jackpot on Let's Have A Word! 🎉🟩"

- **Dev Mode: 20% Pre-Populated Wrong Words**
  - Automatically marks ~20% of wheel words as "wrong" in dev mode
  - Excludes winning word from pre-population
  - Deterministic seeded random selection (consistent per answer)
  - No persistence needed - regenerated on each load
  - Useful for visual testing and debugging

- **Database Schema Updates**
  - Added `wheelStartIndex` (INT) to `dailyGuessState` table
  - Added `wheelRoundId` (INT) for optional per-round reset
  - Migration generated: `drizzle/0000_bouncy_blizzard.sql`

- **New Components**
  - `WinnerShareCard.tsx` - Celebration modal with social sharing
  - Pulse-glow CSS animation in `globals.css`

### ✅ Milestone 4.13 - Clean English Dictionary

Replaced Wordle-derived dictionaries with clean, modern English wordlists using frequency-based filtering:

- **Clean Dictionaries**
  - **GUESS_WORDS_CLEAN**: 5,884 words (all valid guesses)
  - **ANSWER_WORDS_EXPANDED**: 3,500 words (curated answer candidates)
  - Located in `src/data/guess_words_clean.ts` and `src/data/answer_words_expanded.ts`
  - All words in UPPERCASE for consistency
  - Invariant maintained: ANSWER_WORDS_EXPANDED ⊆ GUESS_WORDS_CLEAN

- **Frequency-Based Filtering**
  - Uses wordfreq library for real-world word frequency analysis
  - Zipf frequency thresholds: ≥2.5 for guesses, ≥3.0 for answers
  - Generated from ~38k 5-letter words in wordfreq English corpus
  - No arbitrary shape-based filters (consonant patterns, vowel counts, etc.)
  - Includes common words like CRASS, excludes garbage like MENIL

- **Filtering Criteria**
  - No Scrabble/crossword garbage (AALII, AARGH, XYSTI, etc.)
  - No offensive words or slurs
  - No proper nouns (names, places, brands)
  - No protocol/organization acronyms (HTTPS, NORAD, LGBTQ)
  - Real, modern English vocabulary only

- **Crypto/Farcaster Terminology Whitelist**
  - Includes game-relevant crypto/Farcaster terms regardless of frequency
  - WAGMI, DEGEN, STAKE, YIELD, TOKEN, CHAIN, BLOCK, CASTS
  - ALPHA, PONZI, SHILL, LAMBO, DEPEG, NOUNS, ZCASH
  - NOICE, BANKR, SENPI, CLANK, DOODS, PERPS, SNIPE
  - Ensures players can use terminology familiar to the community

- **Plural Handling**
  - Heuristic-based plural detection
  - Plurals allowed in guess dictionary
  - Most plurals excluded from answer dictionary (reduces by ~1k words)
  - Common/essential plurals may be included

- **Generation Script**
  - `src/scripts/generate-frequency-dictionaries.py` - Frequency-based generator (Python)
  - Requires: `pip install wordfreq`
  - Comprehensive blacklists for offensive, proper nouns, and garbage words
  - Crypto/Farcaster whitelist for community-relevant terms
  - Run: `python3 src/scripts/generate-frequency-dictionaries.py`

- **Integration**
  - Updated `src/lib/word-lists.ts` to use clean dictionaries
  - All game logic now uses frequency-filtered word lists
  - Backward compatible with existing game state
  - Validated: CRASS included, MENIL excluded

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

Finalized integration of canonical word lists (later unified in Milestone 7.1):

- **Unified Word List** (updated in 7.1)
  - **WORDS**: 4,439 curated words (single list for guessing and answers)
  - Located in `src/data/guess_words_clean.ts`
  - Categories: CORE_COMMON, BIG_PLACES, COMMON_NAMES, MORPHOLOGICAL, SLANG_ALLOWLIST
  - BANNED_GUESSES excluded automatically
  - All words in UPPERCASE for consistency

- **Integration**
  - Answer selection uses unified WORDS list
  - Guess validation uses same WORDS list (O(1) Set lookup)
  - Wheel rendering displays all WORDS with status
  - SEED_WORDS deprecated and removed from game logic

- **Word List Processing**
  - Curated categories for fair gameplay
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
  - When a winner has no referrer, the 5% referrer share is split:
    - 2.5% → Top-10 pool (bringing total to 12.5%)
    - 2.5% → Seed (bringing total to 7.5%, still capped at 0.03 ETH)
  - Seed overflow goes to creator wallet
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

- **Bonus System (Milestone 5.4c: Market Cap Tiers)**
  - Holding ≥ 100M CLANKTON → +2-3 free guesses per day (tiered by market cap)
    - +2 guesses/day when market cap < $250k
    - +3 guesses/day when market cap >= $250k
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

Complete economic system for prize distribution (Updated January 2026):

- **Per-Guess Economics**
  - Pack purchases add to prize pool (after platform fee)
  - Prize pool accumulates until round is won

- **Jackpot Resolution (Onchain, Atomic)**
  - 80% → Winner (always)
  - 10% → Top-10 Early Guessers (weighted: 19%/16%/14%/11%/10%/6%×5)
  - 5% → Next Round Seed (capped at 0.03 ETH, overflow → creator)
  - 5% → Referrer (if winner has one)
  - Without referrer: 12.5% Top-10, 7.5% seed
  - Top-10 ranking: by volume, tiebreaker earliest first guess

- **Database Tables**
  - `system_state` - Creator balance tracking
  - `round_payouts` - Payout records per round

- **Canonical Spec**: See `docs/LHAW_canonical_economics.md`

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
  - +2-3 for CLANKTON holders (≥100M tokens, tiered by market cap)
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
  - Import unified WORDS list from `guess_words_clean.ts` (4,439 curated words)
  - Single source of truth for answers and guesses (Milestone 7.1)
  - SEED_WORDS deprecated (Milestone 4.11)

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

### Random Wheel Start Position - Dev Mode Override

The word wheel displays all 4,439 possible guess words, and each user sees a different starting position to provide variety and prevent pattern recognition.

**Production Behavior:**
- Random wheel start position is generated **once per day per user** (at 11:00 UTC)
- Persisted in database for stability across page refreshes
- Same user sees the same wheel position throughout the entire UTC day

**Dev Mode Behavior:**
- In dev mode, the wheel start position is **randomized on every page load**
- Does NOT persist or reuse from database
- Helps speed up iteration on wheel animations, UI behavior, and testing different alphabetical positions
- Perfect for testing how the wheel looks at different starting points (A, M, Z, etc.)

To enable dev mode for the wheel (and other dev features):

1. **Set the environment variable** in your `.env.local` file:
   ```bash
   LHAW_DEV_MODE=true
   ```

2. **Restart your dev server**:
   ```bash
   npm run dev
   ```

3. **Refresh the page** - You'll see the wheel start at a different random position each time

4. **Check console logs** - Look for: `🎡 [DEV MODE] Generated fresh random wheel start index`

**Note:** This dev mode override also affects other game features like the guess API and round state, allowing you to test different game scenarios without database persistence.

## Analytics (Milestone 5.2)

**Let's Have A Word** includes a comprehensive analytics system for tracking user activity, game metrics, and business intelligence. The system is feature-flagged and includes a web-based admin dashboard with Neynar SIWN authentication.

### Overview

The analytics system tracks key metrics including:
- **DAU/WAU** - Daily and weekly active users
- **Free/Paid Ratio** - Free vs paid guess usage
- **Jackpot Growth** - Prize pool evolution over time
- **Referral Funnel** - Referral sharing, joins, wins, and bonus unlocks
- **Raw Events** - Complete event log with pagination

### Database Setup

Analytics data is stored in Neon PostgreSQL:

1. **Analytics Events Table** - Single fact table for all events
   ```sql
   CREATE TABLE analytics_events (
     id SERIAL PRIMARY KEY,
     event_type VARCHAR(100) NOT NULL,
     user_id VARCHAR(100),
     round_id VARCHAR(100),
     data JSONB,
     created_at TIMESTAMP DEFAULT NOW() NOT NULL
   );
   ```

2. **Materialized Views** - Pre-aggregated metrics
   - `view_dau` - Daily active users
   - `view_wau` - Weekly active users (ISO week)
   - `view_free_paid_ratio` - Free vs paid guess breakdown
   - `view_jackpot_growth` - Jackpot ETH by day
   - `view_referral_funnel` - Referral metrics

3. **Running Migrations**
   ```bash
   # Generate migration (already done)
   npm run db:generate

   # Apply migrations
   npm run db:migrate

   # Apply analytics views (REQUIRED for admin dashboard)
   # Option 1: Use the setup script (recommended)
   ./scripts/setup-analytics-views.sh

   # Option 2: Apply manually
   psql $DATABASE_URL < drizzle/0001_analytics_views.sql
   ```

   **⚠️ Important:** The analytics views must be created before accessing the admin dashboard at `/admin/analytics`, otherwise the API endpoints will return 500 errors. See `drizzle/README.md` for detailed setup instructions.

### Environment Variables

Configure analytics with the following environment variables:

```bash
# Analytics Feature Flags
ANALYTICS_ENABLED=true        # Master on/off switch for logging + dashboard
ANALYTICS_DEBUG=false         # Extra server logs for analytics (optional)

# User Quality Gating (Milestone 5.3)
USER_QUALITY_GATING_ENABLED=true  # Enable anti-bot user quality check

# Admin Access Control
LHAW_ADMIN_USER_IDS=6500,1477413  # Comma-separated FIDs allowed to see dashboard

# Neynar SIWN
NEXT_PUBLIC_NEYNAR_CLIENT_ID=<your-neynar-client-id>  # Public client ID
NEYNAR_API_KEY=<your-neynar-api-key>                  # Server-side API key
```

**Important:**
- `NEXT_PUBLIC_NEYNAR_CLIENT_ID` must be public (used client-side by @neynar/react)
- `NEYNAR_API_KEY` stays server-side only
- `LHAW_ADMIN_USER_IDS` gates all analytics UI and APIs
- Confirm on the Neynar app SIWN tab that `https://lets-have-a-word.vercel.app` is an authorized origin
- Permissions: **Read + Write** are enabled (Write is required for SIWN)

**Code Architecture Notes:**

**CRITICAL: Provider Scoping (BUG FIX #5 - 2025-11-24)**

To prevent server-side bundling issues with `@farcaster/miniapp-sdk`, providers are scoped to specific pages:

- **`pages/_app.tsx`**: Minimal, NO providers
  - Only imports global styles
  - Does NOT wrap pages with any providers

- **`pages/index.tsx`** (Game page):
  - Wraps with `WagmiProvider` + `QueryClientProvider`
  - Imports `@farcaster/miniapp-sdk` for game functionality
  - Uses `@farcaster/miniapp-wagmi-connector` for wallet connection

- **`pages/admin/analytics.tsx`** (Admin page):
  - Wraps with `NeynarContextProvider` for SIWN authentication
  - ZERO dependency on Farcaster miniapp ecosystem
  - Uses standard React Query for API calls

**SDK Import Restrictions:**

- `@farcaster/miniapp-sdk` should **ONLY** be imported in:
  - `pages/index.tsx` (main game page)
  - Game-specific components (SharePromptModal, WinnerShareCard, StatsSheet, etc.)
  - `src/lib/haptics.ts` (used only by game components)

- `@farcaster/miniapp-sdk` must **NEVER** be imported in:
  - `pages/_app.tsx` (would affect ALL pages)
  - `pages/admin/*` (admin pages use SIWN, not miniapp context)
  - Any server-side code or API routes
  - Shared utilities used by both game and admin pages

**Why This Matters:**

- The miniapp SDK is **client-side only** and NOT compatible with Node.js server environment
- `@farcaster/miniapp-wagmi-connector` has miniapp SDK as a peer dependency
- If wagmi is in `_app.tsx`, it bundles the SDK for ALL pages including admin
- This causes "Cannot use import statement outside a module" errors in Vercel SSR

### Analytics Events

The system logs the following event types:

**User Activity:**
- `daily_open` - User opens the app (first action of day)
- `free_guess_used` - Free guess consumed
- `paid_guess_used` - Paid guess consumed (includes ETH spent in data)
- `GUESS_PACK_USED` - Paid guess credit consumed (includes credits_remaining, round_id, fid)

**Referrals:**
- `referral_join` - New user joined via referral link
- `referral_win` - Referred user won the jackpot
- `share_bonus_unlocked` - User unlocked share bonus (+1 free guess)
- `SHARE_SUCCESS` - User successfully shared to Farcaster (includes cast hash)

**Rounds:**
- `round_started` - New round created
- `round_resolved` - Round completed with winner (includes payout breakdown)

**Fairness & Integrity (Milestone 5.3):**
- `FAIRNESS_ALERT_HASH_MISMATCH` - Critical: commit hash doesn't match revealed answer
- `FAIRNESS_ALERT_PAYOUT_MISMATCH` - High: payout amounts don't follow economic rules
- `FAIRNESS_ALERT_SUSPICIOUS_SEQUENCE` - Medium: suspicious patterns detected
- `PRIZE_AUDIT_MISMATCH` - Prize pool growth doesn't match paid guesses
- `FAIRNESS_AUDIT_COMPLETED` - Full audit completed

**Simulations (Milestone 5.3):**
- `SIM_STARTED` - Simulation run started
- `SIM_COMPLETED` - Simulation run completed
- `CLUSTER_ALERT` - Wallet clustering detected potential sybil attack
- `RAPID_FIRE_ALERT` - Suspicious rapid-fire win pattern detected
- `FRONTRUN_RISK` - Front-run vulnerability assessment result
- `RUNWAY_WARNING` - Jackpot runway projection warning

**User Quality (Milestone 5.3):**
- `USER_QUALITY_BLOCKED` - User blocked due to low quality score
- `USER_QUALITY_REFRESHED` - User quality score refreshed from Neynar

All events include:
- `event_type` - Event identifier
- `user_id` - FID (optional)
- `round_id` - Round ID (optional)
- `data` - JSONB payload with event-specific data
- `created_at` - Timestamp

### Admin Dashboard

Access the analytics dashboard at **`/admin/analytics`**

#### Login Flow

1. Navigate to `/admin/analytics`
2. Click "Sign in with Neynar" button
3. Complete Neynar SIWN authentication
4. System checks if your FID is in `LHAW_ADMIN_USER_IDS`
5. If authorized, dashboard loads with tabs for each metric

#### Dashboard Features

- **DAU Tab** - Daily active user counts
- **WAU Tab** - Weekly active user counts
- **Free/Paid Ratio Tab** - Free vs paid guess breakdown with ratio
- **Jackpot Growth Tab** - Prize pool evolution by day
- **Referral Funnel Tab** - Shares → Joins → Wins → Bonuses
- **Raw Events Tab** - Paginated event log with expandable JSON data
- **Fairness & Integrity (Milestone 5.3)** - Alert monitoring, prize audit summary, health status
- **User Quality Gating (Milestone 5.3)** - Average score, eligible/blocked counts, blocked attempts
- **Referral Performance (Milestone 5.3)** - Referral-generated guesses, wins, payouts, top referrers
- **Adversarial Simulations (Milestone 5.3)** - Run and view simulation results
- **Guess Distribution (Milestone 5.3)** - Histogram of guesses to solve

#### Access Control

- Only FIDs listed in `LHAW_ADMIN_USER_IDS` can access the dashboard
- Non-admin users see "Access Denied" message
- All analytics API endpoints (`/api/admin/analytics/*`) enforce admin check
- SIWN session is validated on every request

### Development & Testing

**Testing with Dev FID:**
```bash
# Set yourself as admin in .env.local
LHAW_ADMIN_USER_IDS=12345  # Replace with your FID
ANALYTICS_ENABLED=true

# Enable analytics debugging
ANALYTICS_DEBUG=true  # Optional: verbose logs

# Access dashboard
# Navigate to http://localhost:3000/admin/analytics
# Use devFid parameter for testing without SIWN
```

**Adding New Analytics Events:**

1. Add event type to `AnalyticsEventTypes` in `src/lib/analytics.ts`
2. Call `logAnalyticsEvent()` from appropriate backend handler
3. Optionally extend views/dashboard to display the new event

Example:
```typescript
import { logAnalyticsEvent, AnalyticsEventTypes } from '../lib/analytics';

// Log an event
await logAnalyticsEvent(AnalyticsEventTypes.DAILY_OPEN, {
  userId: fid.toString(),
  data: { source: 'miniapp' },
});
```

### Fire-and-Forget Design

All analytics logging is:
- **Non-blocking** - Never delays user-facing operations
- **Error-tolerant** - Failures don't affect game functionality
- **Feature-flagged** - Can be disabled via `ANALYTICS_ENABLED=false`
- **Debug-friendly** - Optional verbose logging via `ANALYTICS_DEBUG=true`

### Notes

- Analytics is **web-only** (not available inside the mini app frame)
- Views are read-only SQL views (not materialized - real-time data)
- Raw events table can grow large - consider archiving old events
- Dashboard uses simple table displays (no charting library dependencies)

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
- User quality score (Milestone 5.3) - Neynar score for anti-bot gating
- User score updated at (Milestone 5.3) - Cache timestamp for score refresh

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

**`announcer_events`** - Farcaster announcement tracking (Milestone 5.1)
- Event type tracking (round_started, round_resolved, jackpot_milestone, etc.)
- De-duplication via unique constraint on (eventType, roundId, milestoneKey)
- Cast hash storage for threading and verification
- Posted timestamp tracking
- Prevents duplicate announcements

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
- +2-3 for CLANKTON holders (≥100M tokens, tiered by market cap)
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
  - +2-3 if holding ≥100M CLANKTON (tiered by market cap)
  - +1 share bonus

### Daily Guess Flow Modal Logic

The game uses smart modal sequencing to offer guesses without being annoying:

**Decision Tree (after each guess):**
1. **If guesses remain** → Only show share modal once per session (if share bonus unused)
2. **If out of guesses** → Show share modal first (if unused and not seen this session)
3. **If share declined/used** → Show pack purchase modal (if packs available)
4. **Otherwise** → Show "out of guesses" state

**Session Tracking:**
- `hasSeenShareModalThisSession` - Prevents share modal spam
- `hasSeenPackModalThisSession` - Prevents pack modal spam
- Both reset on page refresh or new session

**Implementation:**
- Hook: `useModalDecision` (`src/hooks/useModalDecision.ts`)
- Returns: `decideModal()`, `markShareModalSeen()`, `markPackModalSeen()`
- See GAME_DOCUMENTATION.md for detailed flow diagrams

### Economics (Milestone 3.1, Updated January 2026)

**Jackpot Resolution (Onchain, Atomic)**
- 80% → Winner (always)
- 10% → Top-10 Early Guessers (tiered distribution)
- 5% → Next Round Seed (capped at 0.03 ETH, overflow → creator)
- 5% → Referrer (if winner has one)

**Non-Referral Prize Flow (Milestones 4.9, 6.9)**

When a winner **has a referrer**:
- Winner gets 80%
- Top-10 get 10% (tiered split)
- Seed gets 5% (capped at 0.03 ETH)
- Referrer gets 5%

When a winner **does NOT have a referrer**:
- Winner gets 80%
- Top-10 get 12.5% (10% base + 2.5% from referrer share)
- Seed gets 7.5% (5% base + 2.5% from referrer share, still capped at 0.03 ETH)

This prevents players from avoiding referral links to maximize their payout and keeps the growth loop healthy.

**Top-10 Tiered Distribution (Milestone 6.9b)**
| Rank | Share |
|------|-------|
| #1 | 19% |
| #2 | 16% |
| #3 | 14% |
| #4 | 11% |
| #5 | 10% |
| #6-10 | 6% each |

**Top-10 Ranking**
- Ranked by total paid guess volume
- Tiebreaker: earliest first guess time
- If < 10 guessers: shares renormalized to sum to 100%

### Provable Fairness

Each round uses commit-reveal with onchain commitment:
1. Backend chooses answer (cryptographically random) + random salt
2. Computes `H(salt||answer)` commitment hash
3. Writes commitment to JackpotManager smart contract on Base (immutable, timestamped)
4. Stores commitment in database (redundant backup)
5. On resolution, reveals `salt` and `answer`
6. Anyone can verify at `/verify`:
   - `H(salt||answer) === commit_hash` (computed client-side)
   - Onchain commitment matches database commitment
   - Commitment was recorded before round started

**Verification Page**: `/verify` allows anyone to independently verify any round's fairness.

**Security Layers**:
- Answer encrypted at rest (AES-256-GCM)
- Cryptographic word selection (`crypto.randomInt()`)
- Immutable onchain commitment
- Public verification interface

### User Quality Gating (Milestone 5.3)

To prevent bot/sybil abuse, **only Farcaster users with a Neynar User Score ≥ 0.55 may submit guesses**.

- **Score Source**: Neynar's experimental user quality score (0.0-1.0)
- **Threshold**: 0.55 minimum required (lowered from 0.6 in Jan 2025)
- **Caching**: Scores cached in database for 24 hours
- **Refresh**: Automatic refresh when cache expires

**How it works:**
1. User attempts to submit a guess
2. System checks user's cached quality score
3. If cache expired, fetches fresh score from Neynar API
4. If score < 0.55, returns `INSUFFICIENT_USER_SCORE` error
5. Blocked attempts are logged as `USER_QUALITY_BLOCKED` analytics events

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
- Enable with `USER_QUALITY_GATING_ENABLED=true`
- Requires `NEYNAR_API_KEY` to be configured
- Threshold is 0.55 (configurable in `src/lib/user-quality.ts`)

### Fairness Monitoring (Milestone 5.3)

The fairness monitoring system validates game integrity in real-time:

- **Commit-Reveal Validation**: Verifies `H(salt || answer) === commitHash` for all resolved rounds
- **Onchain Payout Verification**: All payouts verifiable on BaseScan via `PayoutSent` events
- **Suspicious Pattern Detection**: Flags unusual win patterns (same winner, same answer)
- **Automated Alerts**: Logs `FAIRNESS_ALERT_*` events when issues detected

**Running Audits:**
```bash
# Via API
curl -X POST /api/admin/analytics/fairness \
  -H "Content-Type: application/json" \
  -d '{"action": "audit"}'
```

### Adversarial Simulations (Milestone 5.3)

The simulation engine models attack vectors and stress scenarios:

| Simulation | Purpose |
|------------|---------|
| `wallet_clustering` | Detect sybil attacks via shared wallets/referral chains |
| `rapid_winner` | Flag statistically improbable win streaks |
| `frontrun_risk` | Assess vulnerabilities in commit-reveal scheme |
| `jackpot_runway` | Project prize pool sustainability under various scenarios |
| `full_suite` | Run all simulations with combined risk report |

**Running Simulations:**
```bash
# Via API
curl -X POST /api/admin/analytics/simulations \
  -H "Content-Type: application/json" \
  -d '{"type": "full_suite"}'
```

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

### Farcaster Announcer Bot (Milestone 5.1)

The game automatically posts announcements to Farcaster from the official **@letshaveaword** account (FID 1477413).

- **What Gets Announced:**
  - **Round Started** - When a new round begins (includes shortened hash and verify link)
  - **Round Resolved** - When someone wins (includes verify link, top 10 early guessers)
  - **Jackpot Milestones** - When prize pool reaches 0.1, 0.25, 0.5 ETH (🔥) or 1.0 ETH (🚨)
  - **Guess Milestones** - When total guesses reach 1K, 2K, 3K, 4K
  - **Referral Wins** - When a winner's referrer earns 10% of the jackpot

- **Dev Mode Safety:**
  - Announcer is **completely disabled** when `NODE_ENV !== 'production'`
  - No announcements are ever posted from dev, staging, or preview environments
  - Debug logs available via `ANNOUNCER_DEBUG_LOGS=true`

- **How It Works:**
  - Uses Neynar's agent/signer infrastructure
  - Signer UUID: `75a966ee-fcd5-4c04-a29f-a5d8cc646902`
  - All announcements are idempotent (stored in `announcer_events` table)
  - Announcer failures never break the game (non-blocking, graceful error handling)
  - Controlled via `ANNOUNCER_ENABLED` environment flag

- **Configuration:**
  - Set required env vars: `NEYNAR_API_KEY`, `NEYNAR_SIGNER_UUID`, `ANNOUNCER_FID`
  - Enable with `ANNOUNCER_ENABLED=true` in production only
  - Optional verbose logging with `ANNOUNCER_DEBUG_LOGS=true`

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
3. **The Jackpot** - Prize distribution (winner, referrer, Top-10)
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
├── hooks/             # React hooks
│   ├── index.ts           # Hooks barrel export
│   ├── useTranslation.ts  # i18n translation hook
│   └── useModalDecision.ts # Daily guess flow modal logic
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
│   ├── announcer.ts       # Farcaster announcer bot (Milestone 5.1)
│   ├── analytics.ts       # Analytics event logging (Milestone 5.2)
│   ├── user-quality.ts    # User quality gating (Milestone 5.3)
│   ├── haptics.ts         # Haptic feedback SDK wrapper (Milestone 4.7)
│   ├── input-state-haptics.ts  # Haptic feedback hook (Milestone 4.7)
│   ├── input-state.ts     # Input state machine (Milestone 4.6)
│   ├── testWords.ts       # Dev-only test word lists (Milestone 4.5)
│   └── devMidRound.ts     # Mid-round test mode (Milestone 4.5)
├── services/          # Service modules (Milestone 5.3)
│   ├── fairness-monitor/
│   │   ├── index.ts       # Fairness validation & audit
│   │   └── prize-audit.ts # Prize pool verification
│   └── simulation-engine/
│       └── index.ts       # Adversarial simulations
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
│   ├── guess.ts           # Guess submission (with user quality check)
│   ├── round-state.ts     # Round status
│   ├── user-state.ts      # User daily allocations
│   ├── share-callback.ts  # Share bonus verification (logs SHARE_SUCCESS)
│   ├── wheel.ts           # Wheel data
│   ├── user/              # User endpoints (Milestone 4.3)
│   │   ├── stats.ts       # User statistics
│   │   └── referrals.ts   # Referral data
│   └── admin/             # Admin endpoints
│       ├── me.ts          # Admin status check
│       └── analytics/     # Analytics endpoints (Milestone 5.2/5.3)
│           ├── dau.ts         # Daily active users
│           ├── wau.ts         # Weekly active users
│           ├── events.ts      # Raw events (paginated)
│           ├── free-paid.ts   # Free/paid ratio
│           ├── jackpot.ts     # Jackpot growth
│           ├── referral.ts    # Referral funnel
│           ├── fairness.ts    # Fairness audits (Milestone 5.3)
│           ├── simulations.ts # Run simulations (Milestone 5.3)
│           ├── performance.ts # CLANKTON advantage (Milestone 5.3)
│           └── export.ts      # Data export (Milestone 5.3)
├── admin/
│   └── analytics.tsx      # Admin dashboard (Milestone 5.2/5.3)
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

## Architecture Overview

### Tech Stack
- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes (serverless)
- **Database**: PostgreSQL with Drizzle ORM
- **Blockchain**: Base (Ethereum L2), Ethers.js v6
- **Social**: Farcaster miniapp SDK, Neynar API

### Smart Contract
- **JackpotManager Proxy**: `0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5` (Base Mainnet)
- **Implementation**: UUPS upgradeable pattern (OpenZeppelin)
- **Key Functions**:
  - `resolveRoundWithPayouts()` - Atomic multi-recipient payout (winner + referrer + Top-10)
  - `purchaseGuesses()` - 80/20 split (jackpot/seed+creator)
  - `seedJackpot()` - Operator seeding for new rounds
- **Features**: Jackpot management, guess purchase, onchain prize distribution, CLANKTON oracle
- **Events**: `RoundResolvedWithPayouts`, `PayoutSent`, `GuessesPurchased`, `RoundStarted`

### CLANKTON Oracle
- Market cap oracle for dynamic bonus tiers
- Threshold: $250,000 USD for tier upgrade
- Bonus tiers: LOW (+2 guesses), HIGH (+3 guesses)
- Staleness threshold: 24 hours
- Updated via `npm run oracle:cron`

## Daily Free Guess Rules

Each player's daily allocation:
1. **Base**: 1 free guess per day
2. **CLANKTON Bonus**: +2 or +3 guesses if holding 100M+ tokens
   - Market cap < $250k: +2 guesses/day
   - Market cap >= $250k: +3 guesses/day
3. **Share Bonus**: +1 guess for sharing to Farcaster (once per day)
4. **Paid Packs**: Buy 3-packs, up to 3 packs/day (9 paid guesses max)

**Total possible daily guesses**: 12-13 (1 + 3 + 1 + 9)

## Guess Pack System

- **Pack Size**: 3 guesses per pack
- **Daily Limit**: 3 packs (9 guesses max)
- **Price**: 0.0003 ETH per pack (configurable via `GUESS_PACK_PRICE_ETH`)
- **Tracking**: Per UTC day, resets at 11:00 UTC

## Referral System

- **Reward**: 10% of jackpot when referred user wins
- **Tracking**: `referrerFid` field on users table
- **Payouts**: Onchain, atomic (part of `resolveRoundWithPayouts`)
- **Link format**: `https://lets-have-a-word.vercel.app?ref={fid}`
- **Self-referral**: Blocked at signup
- **No referrer flow**: 7.5% → Top-10 pool, 2.5% → next round seed

## How to Run

### Development

```bash
# Install dependencies
npm install

# Set up database
npm run db:push

# Run development server
npm run dev
```

### Production Scripts

```bash
# Run CLANKTON market cap oracle (cron)
npm run oracle:cron

# Create a new round (after previous round resolves)
npm run create-round
```

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://...

# Farcaster/Neynar
NEYNAR_API_KEY=...
NEXT_PUBLIC_NEYNAR_CLIENT_ID=...

# Blockchain (Base)
BASE_RPC_URL=https://mainnet.base.org
JACKPOT_MANAGER_ADDRESS=0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5
OPERATOR_PRIVATE_KEY=...
OPERATOR_WALLET=0xaee1ee60...
CREATOR_PROFIT_WALLET=0x3Cee63...

# Economy
GUESS_PACK_PRICE_ETH=0.0003
CLANKTON_MARKET_CAP_USD=...

# Analytics
ANALYTICS_ENABLED=true
ANALYTICS_DEBUG=false

# Admin
LHAW_ADMIN_USER_IDS=6500,1477413
```

## What's Next?

Planned future milestones:

### 🚀 Milestone 7.0 - Pre-Production QA
- Comprehensive testing of all flows
- Mobile UI testing
- Performance optimization
- Security audit

### 💰 Milestone 6.4 - Payout Engine
- Referral ETH payouts
- Automated payout processing
- Transaction tracking

### 🎯 Future Enhancements
- Multi-wallet CLANKTON support
- XP system v2 with progression
- Leaderboard system
- Full localization (translations)
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
