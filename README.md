<div align="center">
  <img src="public/word-token-logo.png" alt="Let's Have A Word" width="120" />

  <h1>Let's Have A Word</h1>

  <p><strong>Massively multiplayer word hunt where everyone eliminates wrong answers until one player hits the ETH jackpot</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js" alt="Next.js 14" />
    <img src="https://img.shields.io/badge/Base-0052FF?style=flat-square&logo=ethereum&logoColor=white" alt="Base" />
    <img src="https://img.shields.io/badge/Farcaster-855DCD?style=flat-square" alt="Farcaster" />
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Vercel-000?style=flat-square&logo=vercel" alt="Vercel" />
  </p>

  <p>
    <a href="https://letshaveaword.fun">Play</a> &middot;
    <a href="https://letshaveaword.fun/verify">Verify</a> &middot;
    <a href="https://letshaveaword.fun/admin">Admin</a> &middot;
    <a href="https://warpcast.com/letshaveaword">@letshaveaword</a>
  </p>
</div>

---

## How It Works

```
Round 14 starts → answer committed onchain (keccak256)
  ├─ Everyone guesses the SAME 5-letter word
  ├─ Wrong guesses spin onto a shared elimination wheel
  ├─ First correct guesser wins the ETH jackpot
  └─ Anyone can verify fairness at /verify
```

One secret word. One winner. Provably fair.

---

## Why Let's Have A Word?

- **Provably fair** — commit-reveal with onchain commitment on Base; anyone can verify
- **ETH jackpots** — 80% to the winner, 10% to Top-10 early guessers, atomically distributed onchain
- **$WORD tokenomics** — hold tokens for bonus guesses, find hidden bonus/burn words each round, stake for yield
- **XP tiers** — earn XP from gameplay, unlock staking multipliers (1.0x → 1.6x)
- **Farcaster-native** — mini app with Quick Auth, push notifications, and social sharing
- **Open admin** — full analytics dashboard, fairness monitoring, adversarial simulations, kill switch

---

## Game Economics

| Mechanic | Details |
|----------|---------|
| **Prize Split** | 80% winner · 10% Top-10 · 5% seed · 5% referrer |
| **Guess Types** | Free (base) → $WORD bonus → Share bonus → Paid (consumed in order) |
| **Daily Allocation** | 1 free + up to 3 $WORD + 1 share + 9 paid = **14 max/day** |
| **Pack Pricing** | 3 guesses per pack, up to 3 packs/day, dynamic pricing by phase |
| **Top-10 Tiers** | #1: 19% · #2: 16% · #3: 14% · #4: 11% · #5: 10% · #6-10: 6% each |
| **XP Staking** | Passive 1.0x · Bronze 1.15x · Silver 1.35x · Gold 1.60x |
| **Bonus Words** | 10 per round — find one, earn 5M $WORD |
| **Burn Words** | 5 per round — find one, burn 5M $WORD + earn "Arsonist" wordmark |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Client (Farcaster Mini App)                        │
│  Wagmi v3 · Tailwind CSS · Quick Auth               │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  Next.js 14 API Routes (Serverless)                 │
│  Game · Economy · Admin · Cron                      │
└───────┬──────────────┬──────────────┬───────────────┘
        │              │              │
        ▼              ▼              ▼
   PostgreSQL     Base Chain     Upstash Redis
   (Neon)         ┌──────────┐   (Rate Limiting)
   Drizzle ORM    │Jackpot   │
                  │Manager   │
                  │(UUPS)    │
                  ├──────────┤
                  │Word      │
                  │ManagerV2 │
                  └──────────┘
```

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 14 (Pages Router) |
| Database | PostgreSQL (Neon) + Drizzle ORM |
| Chain | Base — JackpotManager (UUPS proxy) + WordManagerV2 |
| Auth | Farcaster Quick Auth (JWT) |
| Cache | Upstash Redis |
| Frontend | Wagmi v3, Tailwind CSS, Farcaster Mini App SDK |
| Testing | Vitest |

---

## Project Structure

```
pages/
├── index.tsx              # Main game page
├── splash.tsx             # OG Hunter prelaunch
├── verify.tsx             # Provable fairness verification
├── admin/index.tsx        # Admin dashboard (Operations · Analytics · Archive · Economics)
└── api/
    ├── guess.ts           # Guess submission
    ├── game.ts            # Unified game state
    ├── round-state.ts     # Live round status
    ├── wheel.ts           # Word wheel data
    ├── purchase-guess-pack.ts
    ├── share-callback.ts
    ├── user/              # User stats & referrals
    ├── admin/             # Operational & analytics endpoints
    └── cron/              # Health checks, oracle, refunds

src/
├── lib/                   # Core game logic
│   ├── guesses.ts         # Guess submission & validation
│   ├── rounds.ts          # Round lifecycle
│   ├── economics.ts       # Prize pool & payouts
│   ├── daily-limits.ts    # Free/paid allocation
│   ├── jackpot-contract.ts # Base contract interactions
│   ├── word-manager.ts    # WordManagerV2 contract
│   ├── encryption.ts      # AES-256-GCM answer encryption
│   ├── announcer.ts       # Farcaster bot (@letshaveaword)
│   ├── xp.ts              # XP event system
│   └── appErrors.ts       # 40+ unified error codes
├── db/schema.ts           # Drizzle schema (all tables)
├── data/guess_words_clean.ts  # 4,438 curated words
└── services/              # Fairness monitor & simulation engine

components/                # React UI components
drizzle/                   # Database migrations
```

---

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
npm run oracle:cron            # Update $WORD market cap oracle
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Neon) |
| `BASE_RPC_URL` | Base network RPC endpoint |
| `BASE_SEPOLIA_RPC_URL` | Sepolia RPC for simulation |
| `NEYNAR_API_KEY` | Farcaster/Neynar API key |
| `NEXT_PUBLIC_NEYNAR_CLIENT_ID` | Neynar client ID (public) |
| `OPERATOR_PRIVATE_KEY` | Contract transaction signing key |
| `ANSWER_ENCRYPTION_KEY` | 32-byte hex for AES-256-GCM |
| `JACKPOT_MANAGER_ADDRESS` | JackpotManager proxy on Base |
| `WORD_MANAGER_ADDRESS` | WordManagerV2 contract on Base |
| `NEYNAR_SIGNER_UUID` | Announcer bot signer UUID |
| `ANNOUNCER_ENABLED` | Enable Farcaster announcements (`true` in prod) |
| `ANALYTICS_ENABLED` | Enable analytics event logging |
| `LHAW_ADMIN_USER_IDS` | Comma-separated admin FIDs |
| `USER_QUALITY_GATING_ENABLED` | Enable anti-bot quality check |

---

## Development Modes

```bash
NEXT_PUBLIC_TEST_MID_ROUND=true   # Pre-seeded round with mock data
NEXT_PUBLIC_LHAW_DEV_MODE=true    # No onchain calls, mock data, always shows tutorial
NEXT_PUBLIC_PRELAUNCH_MODE=1      # Routes all traffic to /splash
```

---

## Code Style

- **Apostrophes**: Use curly apostrophes (\u2019) not straight ones (') in UI text
- **No CLI scripts**: Always create API endpoints in `/pages/api/admin/operational/` for admin tasks — never suggest running npm scripts for operational work

---

## Changelog

### 2026-02-17 (after Round 13)

- **XP-Boosted Staking Rewards**: Connected XP system to staking yield. Four XP tiers (Passive/Bronze/Silver/Gold) with multipliers (1.0x/1.15x/1.35x/1.60x) based on lifetime XP. StakingModal fully wired with live stake/unstake/claim via Wagmi, ticking reward counter, XP tier progression card with roadmap, and tier-up celebration animation. XPSheet now shows live tier progression instead of "Coming Soon." Added 7-day rolling XP rate helper, enriched `/api/word-balance` with XP tier data, created `useStaking` hook, and admin `fund-staking-pool` endpoint.

### 2026-02-16 (after Round 13)

- **Admin Contract Diagnostics**: Added WordManager contract visibility to admin panel alongside JackpotManager. Contract diagnostics card now shows 3 columns (JackpotManager Mainnet, JackpotManager Sepolia, WordManager Mainnet) with staking, burn, and distribution stats. Added $WORD status badge to persistent status strip.
- **Milestone 14 Documentation**: Updated FAQ and game documentation for $WORD token game mechanics — bonus words, burn words, wordmarks, WordManager contract, dual-contract verification.

### 2026-02-06 (after Round 13)

- **Round 13 Recovery**: Built `recover-stuck-round` admin endpoint to fix "zombie rounds" where Phase 1 (DB winner lock) succeeded but Phase 2 (onchain resolution + payouts) failed. Bypasses `getActiveRound()` filter that can't find zombie rounds. Auto-enables dead day after recovery.
- **Guess Submission Resilience**: Added `fetchWithRetry` to client-side guess submission with 12-second timeout and 1 automatic retry on timeout/network failure. Prevents indefinite "SUBMITTING..." hang that caused a player to lose a correct guess in Round 13.
- **Zombie Round Alerting**: Added Sentry `fatal` alert when Phase 2 (onchain payout) fails after Phase 1 (DB winner lock) succeeds. Also added zombie round detection to the cron health check (runs every 30 minutes) so stuck rounds are caught even if the initial alert is lost.
- **Notification Open Tracking**: Added Neynar notification open tracking proxy endpoint and client-side UTM detection for developer portal analytics.

<details>
<summary><strong>Full Milestone History</strong></summary>

### 2026-01-14 (after Round 7)

- **Word List Expansion**: Added 83 new words to CORE_COMMON, bringing total to 4,438 curated words
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

## Milestone 14 - $WORD Token Game Mechanics

Integrated $WORD token rewards and penalties into round gameplay, with onchain commitment and verification via a new WordManagerV2 contract on Base:

- **Bonus Words** (`src/lib/guesses.ts`, `src/lib/word-lists.ts`)
  - Each round includes 10 hidden bonus words drawn from the full dictionary
  - Finding one awards 5M $WORD tokens directly to the player's wallet
  - Detected automatically during guess submission — no special action required
  - Committed onchain before round starts via `keccak256(abi.encodePacked(word, salt))`

- **Burn Words** (`src/lib/burn-words.ts`)
  - Each round includes 5 hidden burn words that destroy $WORD tokens permanently
  - Finding one sends 5M $WORD to `0xdead` (permanent burn)
  - Finder receives +100 XP and the "Arsonist" wordmark — bragging rights, no token reward
  - Same keccak256 commitment system as bonus words

- **Wordmarks** (`src/lib/wordmarks.ts`, `components/WordmarkStack.tsx`)
  - Permanent collectible badges awarded for in-game achievements
  - 9 wordmarks: OG Hunter, Side Quest, Arsonist, Jackpot Winner, Double W, Patron, Quickdraw, Encyclopedic, Baker's Dozen
  - Displayed on profile and archive pages

- **WordManagerV2 Contract** (`src/lib/word-manager.ts`)
  - Standalone contract on Base: `0xD967c5F57dde0A08B3C4daF709bc2f0aaDF9805c`
  - Owner/Operator pattern: deployer wallet for admin, server wallet for game operations
  - `commitRound()` — commits 16 keccak256 hashes (1 secret + 10 bonus + 5 burn) before round starts
  - `claimBonusReward()` / `claimBurnWord()` — verified claims that check hash before execution
  - `distributeTop10Rewards()` — batch top-10 $WORD distribution in one transaction

- **$WORD Staking** (WordManager contract)
  - Users stake $WORD tokens to earn more $WORD staking rewards over time
  - Staked tokens count toward effective balance for holder tier calculations
  - No ETH involved — purely $WORD in, $WORD out
  - Functions: `stake()`, `withdraw()`, `claimRewards()`

- **Top-10 $WORD Rewards** (`src/lib/economics.ts`)
  - Top 10 guessers receive $WORD rewards in addition to ETH payouts
  - Reward amounts scale dynamically with $WORD market cap tiers
  - Same ranking percentages as ETH (19% for #1, 16% for #2, etc.)

- **Dual-Contract Verification** (`pages/verify.tsx`)
  - `/verify` page shows commitments from both JackpotManager (SHA-256) and WordManagerV2 (keccak256)
  - Links to both contracts on BaseScan
  - Manual verification instructions for both hash types

- **Admin Contract Diagnostics** (`components/admin/OperationsSection.tsx`)
  - 3-column diagnostics: JackpotManager Mainnet, JackpotManager Sepolia, WordManager Mainnet
  - WordManager column shows total staked, burned, distributed, and operator status
  - $WORD status badge in persistent status strip across all admin tabs

- **Database Tables**
  - `round_bonus_words` — per-round bonus word storage with encrypted words and salts
  - `round_burn_words` — per-round burn word storage with encrypted words and salts
  - `word_rewards` — audit trail for all $WORD token distributions

- **Environment Variables**
  - `WORD_MANAGER_ADDRESS` — WordManagerV2 contract address on Base

### Milestone 13 - Security: Quick Auth Authentication

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

### Milestone 12 - OG Hunter Prelaunch & Mini App Enhancements

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

### Milestone 11 - Production Hardening & Onchain Pack Purchases

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

- **$WORD Mid-Day Tier Upgrade** (`src/lib/word-token.ts`, `src/lib/daily-limits.ts`)
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
  - Per-source tracking: base, $WORD, share, paid
  - Consumption order: free → $WORD → share → paid
  - `GuessSourceState` interface for detailed breakdown
  - API returns `sourceState` with remaining by source

- **Environment Variables**
  - `BASE_RPC_URL` - Mainnet RPC for transaction verification
  - `BASE_SEPOLIA_RPC_URL` - Sepolia RPC for simulation
  - `RATE_LIMIT_*` - Configurable rate limit thresholds

### Milestone 10 - Provably Fair Onchain Commitment

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
  - Jackpot milestones: 0.1/0.25/0.5 ETH and 1.0 ETH templates
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

### Milestone 9.6 - Economics Dashboard Enhancements

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

### Milestone 9.5 - Kill Switch & Dead Day Operational Controls

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

### Milestone 8.1 - Rotating Share Copy Templates

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

### Milestone 7.x - UI/UX Refinements

Polished user interface with improved transitions, typography, and visual consistency:

- **Archive Page Redesign** (`pages/archive/index.tsx`)
  - Restyled to match RoundArchiveModal design
  - Uses Sohne font family for consistency with admin pages
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

### Milestone 6.9b - Tiered Top-10 Guesser Payouts

Implemented fixed-percentage distribution for Top-10 guessers, replacing equal splits with a rank-based allocation:

- **Tiered Distribution** (`src/lib/top-guesser-payouts.ts`)
  - Rank 1: 19% of Top-10 pool
  - Rank 2: 16%
  - Rank 3: 14%
  - Rank 4: 11%
  - Rank 5: 10%
  - Ranks 6-10: 6% each
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

### Milestone 6.9 - Onchain Multi-Recipient Prize Distribution

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
  - With referrer: 5% referrer, 5% seed (capped at 0.03 ETH, overflow to creator)
  - Without referrer: 12.5% Top-10 guessers, 7.5% seed
  - Self-referral blocked at signup

- **No Offchain Payouts**
  - All prize money distributed onchain
  - No manual intervention or backend reconciliation
  - Trust-minimized, fully transparent

### Milestone 6.7.1 - Incorrect Guess Banner Flow + Input Reset

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

### Milestone 6.7 - XP System (Tracking-First Implementation)

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
  - `CLANKTON_BONUS_DAY` (+10 XP) — $WORD holder daily bonus (event type stored in DB, do not rename)
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

### Milestone 6.6 - Push Notifications & Bug Fixes

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

### Milestone 6.4.7 - Dev Mode Persona Switcher

Added a client-side persona switcher for QA testing different user states without modifying the database:

- **Dev Persona Panel**: Slide-out drawer for selecting test personas
- **Persona Button**: "DEV" pill in top-right (pulsing "DEV*" when override active)
- **7 Predefined Personas**:
  - Real State (no overrides)
  - New Non-Holder (1 free guess, share available)
  - Engaged Non-Holder (share bonus available, no guesses)
  - Non-Holder Out of Guesses (share used, no guesses)
  - $WORD Holder Low Tier (+2 bonus guesses)
  - $WORD Holder High Tier (+3 bonus guesses)
  - Maxed-Out Buyer (max packs, share used, no guesses)
- **Reset Button**: Clear overrides and return to real API state
- **Environment**: Only visible when `NEXT_PUBLIC_LHAW_DEV_MODE=true`

### Milestone 6.4.6 - First Input Lag Optimization

Optimized first keystroke response for instant feedback:

- **Fast Path Handling**: Bypass hook overhead for common input cases
- **Skip Redundant State Updates**: Only call setters when values change
- **Targeted CSS Transitions**: Only animate border-color and box-shadow
- **Deferred Wheel Updates**: Use `requestIdleCallback` for wheel positioning

### Milestone 6.4.5 - Wheel Jump UX: Uniform Perceived Speed

Fixed the "big jump feels slower" issue where large letter jumps (D to R) felt heavier than small jumps (D to E):

- **Two-Mode Animation** based on row distance:
  - **Small Jumps** (10 rows or less): Smooth scroll with fixed 150ms duration
  - **Large Jumps** (more than 10 rows): "Teleport + Settle" - instant snap near target, then animate final 3 rows

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

### Milestone 6.4.4 - Unified Result Banner System

Replaced ad-hoc result banners with a unified, consistent ResultBanner component:

- **ResultBanner Component** (`components/ResultBanner.tsx`)
  - Three variants: `error`, `warning`, `success`
  - Consistent layout across all banner types
  - Theme-appropriate colors (red/amber/green)
  - SVG icons for error/warning, emoji for success
  - Accessibility: `role="status"` and `aria-live="polite"`

- **Banner Messages Updated**
  - Incorrect: "Incorrect. You've made N guess(es) this round." (error)
  - Already guessed: "Already guessed this round." (warning)
  - Not a valid word: "Not a valid word" (warning)
  - Winner: "Correct! You found the word and won this round!" (success)

- **No Emojis for Error/Warning**
  - Error uses red X icon
  - Warning uses amber triangle icon
  - Only success banner keeps emoji

### Milestone 6.4.3 - Input & Word Wheel Performance Audit

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
  - `ExtremeJumpTests` constants for A to Z rotation testing
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

### Milestone 6.4 - UI Polish & Interaction Refinements

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
  - Animation cap ensures A to Z feels same speed as C to D
  - Added `will-change: transform, opacity` for GPU acceleration
  - Uses `requestAnimationFrame` with easeOutCubic easing
  - Debug mode: set `NEXT_PUBLIC_WHEEL_ANIMATION_DEBUG_SLOW=true` to slow animations 3x
  - Config: `config/economy.ts` (WHEEL_ANIMATION_CONFIG)
  - Component: `Wheel.tsx` (updated)

### Milestone 6.3 - UX, Growth, Guess Packs, Referrals, Share Flow

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
  - $WORD mascot for token holders
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
  - Decision tree: share modal, pack modal, out-of-guesses
  - Hook: `useModalDecision` in `src/hooks/useModalDecision.ts`
  - Exported types: `ModalDecision`, `ModalDecisionState`, `ModalDecisionParams`

- **Analytics Events**
  - Guess Pack: `GUESS_PACK_VIEWED`, `GUESS_PACK_PURCHASED`, `GUESS_PACK_USED`
  - Share: `SHARE_PROMPT_SHOWN`, `SHARE_CLICKED`, `SHARE_SUCCESS`
  - Referral: `REFERRAL_MODAL_OPENED`, `REFERRAL_LINK_COPIED`, `REFERRAL_SHARE_CLICKED`
  - Module: `src/lib/analytics.ts` (extended)

### Milestone 5.4 - Round Archive

Comprehensive round archive system for storing and browsing historical round data:

- **Database Schema**
  - New `round_archive` table for archived round data
  - Fields: roundNumber, targetWord, seedEth, finalJackpotEth, totalGuesses, uniquePlayers, winnerFid, winnerCastHash, winnerGuessNumber, startTime, endTime, referrerFid, payoutsJson, salt, clanktonBonusCount (legacy column name), referralBonusCount
  - Index on `round_number` for fast lookups
  - New `round_archive_errors` table for tracking archive anomalies
  - Migration: `drizzle/0002_round_archive.sql`

- **Backend Logic**
  - `archiveRound()` function computes and stores round statistics
  - Idempotent - safe to call multiple times
  - Computes: totalGuesses, uniquePlayers, $WORD bonus count, referral signups
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

### Milestone 5.3 - Advanced Analytics & Fairness Systems

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
  - Requires Neynar User Score of 0.55 or higher to submit guesses
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
  - $WORD holder solve-rate advantage analysis
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
  - `GET /api/admin/analytics/performance` - $WORD advantage & referral metrics
  - `POST /api/admin/analytics/export` - CSV/JSON data export

- **Database Schema Updates**
  - Added `user_score` (DECIMAL 5,3) to users table
  - Added `user_score_updated_at` (TIMESTAMP) for cache management
  - Index on `user_score_updated_at` for efficient queries

- **Configuration**
  - `USER_QUALITY_GATING_ENABLED=true` - Enable anti-bot protection
  - Quality threshold: 0.55 (configurable in code)
  - Score cache duration: 24 hours

### Milestone 5.2 - Analytics System + SIWN Web Admin Login

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
  - `view_referral_funnel` - Referral shares, joins, wins, bonuses

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

### Milestone 5.1 - Farcaster Announcer Bot

Automated Farcaster announcements for round updates, milestones, and jackpot notifications from @letshaveaword (FID 1477413):

- **Announcer Bot**
  - Posts from official @letshaveaword Farcaster account (FID 1477413)
  - Uses Neynar signer infrastructure (UUID: 75a966ee-fcd5-4c04-a29f-a5d8cc646902)
  - Completely disabled in dev mode (NODE_ENV !== 'production')
  - Safe, idempotent, and rate-limited
  - All announcements are de-duplicated via announcer_events table

- **Announcement Types**
  1. **Round Started** - Posted when a new round is created
  2. **Round Resolved** - Posted when someone wins the jackpot
  3. **Jackpot Milestones** - Posted when prize pool crosses thresholds (0.1, 0.25, 0.5, 1.0 ETH)
  4. **Guess Milestones** - Posted at 1K, 2K, 3K, 4K guesses
  5. **Referral Win** - Posted when a winner had a referrer

- **Database Schema**
  - New `announcer_events` table for event tracking
  - Fields: eventType, roundId, milestoneKey, payload, castHash, postedAt
  - Unique constraint on (eventType, roundId, milestoneKey) for idempotency
  - Prevents duplicate announcements

- **Environment Configuration**
  - `NEYNAR_API_KEY` - Neynar API key (required)
  - `NEYNAR_SIGNER_UUID` - Signer UUID for announcer account
  - `ANNOUNCER_FID` - FID of announcer account (1477413)
  - `ANNOUNCER_ENABLED` - Feature flag (must be 'true' in production)
  - `ANNOUNCER_DEBUG_LOGS` - Optional verbose logging
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

### Milestone 4.14 - UI Polish + Dev Mode Enhancements

Comprehensive UI/UX improvements and dev mode features for better visual feedback and testing:

- **Word Wheel Focus Color Rules**
  - Wheel words: unguessed to black, wrong to red, winner to gold
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

### Milestone 4.13 - Clean English Dictionary

Replaced Wordle-derived dictionaries with clean, modern English wordlists using frequency-based filtering:

- **Clean Dictionaries**
  - **GUESS_WORDS_CLEAN**: 5,884 words (all valid guesses)
  - **ANSWER_WORDS_EXPANDED**: 3,500 words (curated answer candidates)
  - Located in `src/data/guess_words_clean.ts` and `src/data/answer_words_expanded.ts`
  - All words in UPPERCASE for consistency
  - Invariant maintained: ANSWER_WORDS_EXPANDED is a subset of GUESS_WORDS_CLEAN

- **Frequency-Based Filtering**
  - Uses wordfreq library for real-world word frequency analysis
  - Zipf frequency thresholds: 2.5 or higher for guesses, 3.0 or higher for answers
  - Generated from ~38k 5-letter words in wordfreq English corpus
  - No arbitrary shape-based filters (consonant patterns, vowel counts, etc.)

- **Filtering Criteria**
  - No Scrabble/crossword garbage
  - No offensive words or slurs
  - No proper nouns (names, places, brands)
  - No protocol/organization acronyms
  - Real, modern English vocabulary only

- **Crypto/Farcaster Terminology Whitelist**
  - Includes game-relevant crypto/Farcaster terms regardless of frequency
  - WAGMI, DEGEN, STAKE, YIELD, TOKEN, CHAIN, BLOCK, CASTS, etc.

- **Generation Script**
  - `src/scripts/generate-frequency-dictionaries.py` - Frequency-based generator (Python)
  - Requires: `pip install wordfreq`
  - Comprehensive blacklists for offensive, proper nouns, and garbage words

### Milestone 4.12 - ETH/USD Price Integration

Real-time ETH to USD conversion for the jackpot display using CoinGecko's free API:

- **CoinGecko Integration**
  - Uses CoinGecko Simple Price API (no API key required)
  - 1-minute client-side caching to avoid rate limits
  - Zero configuration required

- **Price Module** (`src/lib/prices.ts`)
  - `getEthUsdPrice()` async function with caching
  - Graceful error handling and fallback to last known price
  - Never blocks or throws errors in UI

### Milestone 4.11 - Final Word List Integration

Finalized integration of canonical word lists (later unified in Milestone 7.1):

- **Unified Word List** (updated in 7.1)
  - **WORDS**: 4,438 curated words (single list for guessing and answers)
  - Located in `src/data/guess_words_clean.ts`
  - Categories: CORE_COMMON, BIG_PLACES, COMMON_NAMES, MORPHOLOGICAL, SLANG_ALLOWLIST
  - BANNED_GUESSES excluded automatically
  - All words in UPPERCASE for consistency

### Milestone 4.10 - Global Wheel Over All Guessable Words

Redesigned the word wheel to show the complete universe of guessable words from the start:

- **Global Word Wheel**
  - Displays ALL ~10,000 GUESS_WORDS from round start
  - Each word has a status: `unguessed`, `wrong`, or `winner`
  - Creates a global, real-time elimination board shared by all players

- **Status-Based Rendering**
  - `unguessed` - Gray, default state for all words at round start
  - `wrong` - Red, word was guessed incorrectly by someone
  - `winner` - Gold with glow, the correct answer (only shown after win)

- **Updated API Contract**
  - `/api/wheel` returns `WheelResponse` with per-word status
  - Response includes `totalWords`, `roundId`, and array of `{word, status}` objects

- **Performance**
  - Virtualized scrolling handles 10k+ words efficiently
  - Alphabetical sorting maintained
  - Auto-scroll to user input position

### Milestone 4.9 - Non-Referral Prize Flow

Updated jackpot settlement to prevent players from gaming the referral system:

- **Non-Referral Prize Logic**
  - When a winner has no referrer, the 5% referrer share is split:
    - 2.5% to Top-10 pool (bringing total to 12.5%)
    - 2.5% to Seed (bringing total to 7.5%, still capped at 0.03 ETH)
  - Seed overflow goes to creator wallet
  - Prevents incentive to avoid using referral links

### Milestone 4.8 - Dev Mode Game Preview

Enhanced development workflow with realistic mid-round testing and game state preview:

- **Dev Mode Preview Endpoint**
  - New `/api/game` unified state endpoint
  - Returns complete game state in one request
  - Supports forced preview states for UI testing

### Milestone 4.7 - Haptics Integration

Fully integrated haptics across the game using the Farcaster mini-app SDK for tactile feedback:

- **Haptics Utility Module** (`lib/haptics.ts`)
  - Centralized wrapping of Farcaster SDK haptics API
  - Capability detection via `sdk.getCapabilities()`
  - Graceful fallback on unsupported devices
  - Semantic helper functions for common interactions

- **Keyboard, Input State, Guess Lifecycle, and UI Element Haptics**
  - Light impact on letter key presses, soft on backspace, medium on Enter
  - Selection feedback when word becomes valid, error on invalid
  - Success on correct guess, rigid on wrong, warning on out of guesses
  - Light impact on button taps, success on share bonus

### Milestone 4.6 - Input States & Visual Behavior

Comprehensive input state machine for consistent visual feedback and error handling:

- **State Machine Architecture** (`src/lib/input-state.ts`)
  - 10 distinct input states
  - Single source of truth for all input state logic
  - Deterministic state transitions based on user input

- **Visual Feedback System**
  - State-based border colors (gray, blue, red, green)
  - "Ready to guess" glow effect for valid 5-letter words
  - Disabled state when out of guesses

### Milestone 4.5 - Mid-Round Test Mode

Development-only test mode that simulates an active round in progress for easier local testing.

### Milestone 4.4 - Custom In-App Keyboard

Replaced native mobile keyboard with a custom in-app keyboard for consistent cross-device input.

### Milestone 4.3 - Core UX Polish

5-letter box input, haptic feedback, shake animation, first-time overlay, stats/referral/FAQ/XP sheets, and navigation buttons.

### Milestone 4.2 - Share-for-Bonus System

Share prompt modal, Farcaster composer integration, share verification, and daily share bonus tracking.

### Milestone 4.1 - $WORD Integration

Onchain token balance checking, bonus guess system, Wagmi wallet integration, and on-demand user creation.

### Milestone 3.2 - Top Ticker Polish

Live jackpot display, global guess counter, efficient polling, and ETH/USD conversion.

### Milestone 3.1 - Jackpot + Split Logic

Complete economic system: per-guess economics, onchain atomic jackpot resolution (80/10/5/5 split), and database tables for payouts.

### Milestone 2.3 - Wheel + Visual State + Top Ticker

Spinning word wheel, top ticker, and backend seed word population.

### Milestone 2.2 - Daily Limits & Bonus Mechanics

Free guesses, paid packs, and per-user per-day state management with 11:00 UTC reset.

### Milestone 2.1 - Farcaster Authentication

Frame message verification, signer UUID verification, user management, and mobile support.

### Milestone 1.4 - Minimal Frontend

5-letter input with validation, comprehensive feedback, loading states, and mobile optimizations.

### Milestone 1.3 - Guess Logic

Round lifecycle, guess validation, global deduplication, race condition protection, and leaderboard.

### Milestone 1.2 - Round Lifecycle

Round creation with commit-reveal, resolution with payouts, and provable fairness verification.

### Milestone 1.1 - Data Model + Rules

Foundation database schema, word lists, and JSON-based rules system.

</details>

---

## License

**Proprietary — All Rights Reserved**

Copyright &copy; 2025 Jake Bouma (aka "starl3xx"). All rights reserved.

This software and all related materials are proprietary and confidential. No part of this software may be copied, modified, distributed, or used without explicit written permission from the copyright holder. See [LICENSE](LICENSE) file for full details.

For licensing inquiries, contact: starl3xx.mail@gmail.com or https://x.com/starl3xx

---

<div align="center">

**Built on [Farcaster](https://www.farcaster.xyz/) &middot; Powered by [Base](https://base.org/)**

</div>
