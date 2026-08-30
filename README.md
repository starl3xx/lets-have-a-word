<div align="center">
  <img src="public/word-token-logo.png" alt="Let's Have A Word" width="120" />

  <h1>Let's Have A Word</h1>

  <p><strong>Massively multiplayer word hunt where everyone eliminates wrong answers until one player hits the jackpot</strong></p>

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
  ├─ First correct guesser wins the jackpot
  └─ Anyone can verify fairness at /verify
```

One secret word. One winner. Provably fair.

---

## Why Let's Have A Word?

- **Provably fair** — commit-reveal with onchain commitment on Base; anyone can verify
- **$WORD jackpots** — 80% to the winner, 10% to Top-10 early guessers, atomically distributed onchain (rounds 1–33 paid in ETH)
- **$WORD tokenomics** — hold tokens for bonus guesses, find hidden bonus/burn words each round, stake for yield
- **XP tiers** — earn XP from gameplay, unlock staking multipliers (1.0x → 1.6x)
- **Farcaster-native** — mini app with Quick Auth, push notifications, and social sharing
- **Open admin** — full analytics dashboard, fairness monitoring, adversarial simulations, kill switch

---

## Game Economics

| Mechanic | Details |
|----------|---------|
| **Prize Currency** | **$WORD** from round 34 · ETH for rounds 1–33 · packs still bought with ETH |
| **Prize Split** | 80% winner · 10% Top-10 · 5% seed · 5% referrer |
| **Round Seed** | ~$20 of $WORD, oracle-priced at round start from a treasury tranche |
| **Guess Types** | Free (base) → $WORD bonus → Share bonus → Paid (consumed in order) |
| **Daily Allocation** | 1 free + up to 3 $WORD + 1 share + unlimited paid |
| **Pack Pricing** | 3 guesses per pack, uncapped. Stage: 0.0004 / 0.0006 / 0.0008 ETH by round progress. Volume: 1.0× / 1.5× / 2.0× by packs bought that day |
| **Top-10 Tiers** | #1: 19% · #2: 16% · #3: 14% · #4: 11% · #5: 10% · #6-10: 6% each |
| **Top-10 $WORD** | Separate from the pool share — **$3.00** to first place, oracle-priced, paid from the WordManager tranche |
| **XP Staking** | Passive 1.0x · Bronze 1.15x · Silver 1.35x · Gold 1.60x |
| **Bonus Words** | 10 per round — find one, earn **$1.50** of $WORD (oracle-priced, token-capped) |
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
                  │ManagerV3 │
                  └──────────┘
```

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 14 (Pages Router) |
| Database | PostgreSQL (Neon) + Drizzle ORM |
| Chain | Base — JackpotManager (UUPS proxy) + WordManagerV3 (UUPS proxy) |
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
│   ├── word-manager.ts    # WordManager contract (V3)
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
| `WORD_MANAGER_ADDRESS` | WordManager (V3) contract on Base |
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

### 2026-08-30 (during Round 34)

- **The serial RPC calls come out of `/api/user-state`'s tail**: the reward gate is live, and its check ran serially *after* the handler's parallel block, adding its full latency (a chain read on cache miss) to every response; the superguess check sat serially next to it. Both now run inside one five-way `Promise.all`, where they overlap the other reads instead of following them. The connected wallet's $WORD tier gets a wallet-keyed 5-minute Redis cache (a **separate key** from the fid-keyed one, which answers for the *stored* signer wallet rather than whatever is connected), and the two balance reads inside `getEffectiveBalance`/`getEffectiveBalanceChecked` run concurrently instead of one after the other... the gate path and the tier path both pay one RPC round trip now, not two. The same `daily_guess_state` row was also being read three times per request (the handler's own read, then once inside each wheel/source helper); the helpers now accept the already-fetched row. One honest behavior change: during an RPC outage with a connected wallet, the response now really does fall back to the database tier... the old `.catch(→ null)` fallback was dead code, because `getWordBonusTier` swallows errors and returns 0, so an outage silently reported tier 0. The gate itself is untouched: money points still run it uncached, and only *when* the user-state read happens changed, not what it decides.

- **One user-state fetch instead of four, and a referral race closed**: `/api/user-state` had two independent callers — an effect in `index.tsx` and a second fetch inside the `UserState` component — so a cold load fired it up to four times and every incorrect guess three. The waste was the lesser problem. The endpoint *creates the user row* on first sight, and only the `index.tsx` caller sends the `ref` referral param... so whenever the ref-less duplicate won the creation race, the row was born without `referrerFid`. The Farcaster guess path can backfill the referrer later (first-referrer-wins), so the loss became permanent when no ref-carrying guess followed... a referred player who arrived, looked, and left counted for nobody. Now `index.tsx` owns the one fetch (always the superset: `ref`, `initialLoad`, `walletAddress`), `UserState` is purely presentational, and the post-guess modal decision awaits the same in-flight promise instead of fetching again. A monotonic sequence guard also stops a slow no-wallet response from landing late and flipping `isWordTokenHolder` back to false, which was a real, visible race. The old stale-while-revalidate module cache in `UserState` is gone because the remounts it survived are gone: the parent holds the data and simply re-renders it.

- **~150 KB gz and 265 KB of image come off every first load**: an 11-agent audit measured the game shipping ~630 KB gz of route JavaScript, all of it gating `sdk.actions.ready()`, so every byte was splash-screen time. The three cheapest fixes land together. `isValidGuess` moves into a crypto-free `word-validation.ts`... `word-lists.ts` imports `randomInt` from `'crypto'` for server-side answer selection the client never calls, and importing it from `pages/index.tsx` inlined Next's ~100 KB gz crypto-browserify polyfill into the route chunk. Server callers keep their import path through a re-export, and answer selection does not move. The Sign in with Base button becomes a dynamic import... `@base-org/account-ui` embeds BaseSans as a 47 KB gz base64 font chunk that every miniapp player downloaded for a button only the signed-out plain-web branch renders. And the boot screen stops painting with a 291 KB, 1024×1024 icon at 80px: app-internal uses point at a new 25 KB `LHAW-icon-192.png`, while the 1024px original stays for the Farcaster manifest `iconUrl`, which requires exactly that size. The splash image was measured too and deliberately left alone: without a real PNG optimizer the resize saved 6 KB and cost 3x sharpness.

### 2026-08-28 (during Round 34, part two)

- **Wordmarks can be minted onchain, and the player sends the transaction**: twelve achievements that lived only as rows in `user_badges` become soulbound ERC-1155 tokens on Base. The house could airdrop the whole set from the operator wallet for less effort, and that is exactly why it does not... an airdrop attributes one transacting address instead of thousands, and a Wordmark is the player's. So the server signs an EIP-712 voucher saying "this fid earned this Wordmark, mint it to this address, before this time", and the player carries it to the contract and pays the gas. `to` is inside the signed payload, so a voucher lifted from somebody else's network response can only ever mint to its rightful owner. The mint ledger is keyed on the **fid**, not the address: `user_addresses` exists precisely because a Farcaster EOA and a Base Account are different wallets, so an address-keyed ledger would let one player mint the same Wordmark once per wallet they control. Transfers revert, because an achievement that can be sold is a collectible and Early Adopter gates reward-gate grandfathering; burning still works, so nobody is stuck holding one. Nothing is deployed: the whole feature is dormant until `NEXT_PUBLIC_WORDMARKS_ADDRESS` is set.

- **The paymaster sponsors a mint only if this server just authorised it**: adding mints to the sponsorship policy is the first time it has widened since it was written, and it has a trap in it... **a reverting transaction still consumes gas the paymaster pays for**, and the contract reverts on a replayed mint by design. So "targets our contract and calls mint" would have let anybody loop failed mints and drain the balance without ever receiving a token. `willSponsor` now returns the voucher signatures a call depends on and `/api/paymaster` checks each against Redis before forwarding, which binds every sponsored transaction to an authenticated player who is owed a real Wordmark and caps total spend at one mint per fid per Wordmark by construction. Measured cost: 81,147 gas, about $0.0015 a mint at current Base prices, roughly $6 for the whole backfill.

- **Token art is generated, not drawn**: `/api/wordmarks/image/<id>.png` renders the tile at 1000×1000 through the `@vercel/og` machinery that already serves share images, in the real Söhne faces, from the same `WORDMARK_DEFINITIONS` the app reads... so the token art and the in-app Wordmark cannot drift apart. The glyph is Twemoji rather than a system emoji, which matters more here than anywhere else in the app: an image the contract points at must look the same to everyone, and Apple's trophy and Google's trophy are different drawings. Before deploy the twelve renders get pinned to IPFS and `baseUri` points there, because a soulbound token nobody can re-mint is a bad thing to aim at a domain that might one day lapse.

- **Token ids are written out literally**: `WORDMARK_TOKEN_IDS` is a frozen map rather than something derived from the order of `WORDMARK_DEFINITIONS`. Deriving it would mean an innocent reordering of an object literal, the sort of change nobody reviews, silently re-labelled twelve onchain ids and told the holder of `1` their Side Quest had become something else.

### 2026-08-28 (during Round 34)

- **Nine colours on the landing screen had never rendered**: `primary` in `tailwind.config.js` is the shadcn token and carries only `DEFAULT` and `foreground`, so `primary-50`, `primary-200`, `primary-600` and `primary-700` compiled to nothing across the boot screen and the browser fallback. The gradient was the loudest: `from-primary-50` never set `--tw-gradient-stops`, which makes the whole `background-image` invalid, so the page dropped the gradient rather than degrading to one colour. The wallet note lost its violet fill and border and fell back to the preflight grey, and all four invite links lost their colour and inherited whatever surrounded them, which is why the footer pair read as plain grey underlines. Every site moves to `accent-*`, the real violet scale the $WORD purple already comes from, so this is the colour the screen was always asking for. Four content sites also come off `text-gray-400`, which is 2.54:1 on white and fails AA... the contract-address link, the "prize pool" label and both footer lines are now `gray-500` at 4.83:1. The `·` separators stay dim on purpose, because that is what makes the figures read first.

- **The landing screen puts the whole decision above the fold**: ordered logo, title, pitch, paragraph, round, buttons, the two doors landed around 450px and the wallet requirement below them fell off the bottom of an iPhone SE, so the one thing a player has to read before signing was the one thing they had to scroll for. The identity block is now a single 56px row rather than an 80px stacked logo, which buys back about 120px, and the paragraph moves below a hairline: it explains the game to someone still deciding, and someone arriving from a shared round has already decided.

- **The two doors are finally the same shape**: they were the same height and nothing else. `SignInWithBaseButton` is a sealed component whose geometry is unreachable from here, so the Farcaster button now matches Base's measured numbers exactly (56px tall, 8px radius, 17px/400, a 16px mark at an 8px gap) through a shared `.btn-door` class, and the only things that differ are the colour and the mark. The pending state moves onto the same class... it stands exactly where Base's button was a moment ago, and `btn-primary-lg` is 60px tall with a 12px radius, so the row used to resize and change colour under the finger that had just tapped it. The sign-in error moves out of the middle of the page and into the same left-aligned column as the note above it, so it reads as that button's answer rather than a centred sentence floating free.

- **Phosphor icons, and one dependency out**: the `ℹ️` on the wallet note is now `InfoIcon`, paired with `WarningCircleIcon` on the sign-in error so the note and the error read as the same voice at two temperatures... an emoji renders at whatever size and colour the platform picks, and Apple's is a blue-filled tile that fought the note around it. `lucide-react` was in `package.json` and imported in zero files, so it comes out in the same commit and Phosphor is the only icon family rather than a second one. Imports go through the per-icon `dist/ssr/*` subpaths, because Phosphor is not in Next's default `optimizePackageImports` list and a barrel import would pull the whole set into the dev bundle; verified against the built client chunks, which contain the two icons and no others.

### 2026-08-27 (during Round 34)

- **A dormant gate can no longer void a Base App winner**: `wallet-history` counts outgoing transactions with `eth_getTransactionCount`, which for a Base Account is the contract's creation nonce, essentially always 0 however heavily the wallet is used, because its activity flows through the ERC-4337 EntryPoint. Every wallet-native player therefore read as "too fresh" on a *successful* measurement, and only an RPC error fails open. It runs on the guess path and again at win time, so arming `WALLET_HISTORY_GATING_ENABLED` would have voided a Base App jackpot and told the winner their account was flagged for review. Wallet players are now exempt, which is also right on the merits: the reward gate already asks them for about $3 of $WORD per wallet per day, a real cost that the EOA-nonce heuristic was only ever a proxy for.

- **Public lists name Base players properly, and show which door they came through**: the top-guessers leaderboard renders through the shared display helper instead of its own `fid:${fid}` fallback, and carries an `origin` so avatars can be badged Farcaster or Base... which also means the round archive stops being a list where the only way to tell the two apart is that one of them has no name. It stops asking Neynar about synthetic fids at all, since that lookup can only ever miss. One copy rule comes with it: the "@" prefix is a Farcaster thing, so a basename renders bare... "@starl3xx.base.eth" would be wrong twice over, since a basename is a name rather than a handle and the prefix implies a mention resolving to nobody. The rule keys on origin rather than on dots, because a Farcaster username can itself look like a name (vitalik.eth is a valid one).

- **The landing screen leads with the game, not the paperwork**: it opened with a wallet requirement and a sign-in button before saying what the game is, and buried the round underneath. Now: what it is, then the live round, then the two doors. **Play on Farcaster** and **Sign in with Base** are the same size and shape one above the other, because they are alternatives and rendering one as a primary button and the other as a small link misrepresents a choice where both players are equally welcome. The $3 requirement moves below the button and is styled as information rather than a wall... it explains what signing in will ask of you, and a player who already holds $WORD should not read it as a refusal. "A standalone web version may come later" is gone, along with an em dash that had been sitting in that card against the house copy rule.

- **Linking is offered when it is still free, and the code moves by tap**: the stats panel works but a returning veteran has no reason to look there... they play, build a history on the synthetic account, and only later notice their Early Adopter Wordmark is gone. Linking then returns the old account while the guesses made in between stay stranded, because linking deliberately does not migrate play history. So a wallet player is now offered the link once, right after their first sign-in, when the account is blank and linking costs nothing. Dismissible and remembered, because a player with no Farcaster account must not be nagged about one, and gated on the synthetic fid range so somebody who has already linked is never asked again. The code itself is tap-to-copy on the Farcaster side and has a Paste button on the Base side... both are conveniences that stay silent when the clipboard refuses, since the code is on screen and typeable either way.

- **A Farcaster veteran can keep their account in the Base app**: opening the game there made them a brand-new player, because their Base Account is a different wallet from the Neynar-verified EOA the linkage matched on... so they lost reward-gate grandfathering, their Early Adopter Wordmark, their XP, streak and referral history at the exact moment they were being invited through a new door. It cut the other way too: the gate's one-wallet-one-player-per-day claim keys on the address, so one human with two wallets drew two full daily allocations.

  Linking is a two-session handshake because neither side can prove both identities alone... inside the mini app the connected wallet is the Farcaster one, and inside the Base app there is no Farcaster host to issue a Quick Auth token. So the Farcaster session issues a short code, the player carries it across, and the wallet session redeems it. Each half is independently authenticated and the code ties them together. A session names a wallet, and the wallet's current owner is the source of truth: a pre-link session stays cryptographically valid for its full 30 days and cannot be revoked, because Base App's webview pins cookies it will not update... the same jar behaviour as the original lockout, cutting the other way. So resolution asks who owns the address now rather than trusting the fid baked into the token, which also covers linking done on another device. An address vouches for exactly one player, enforced by a unique index rather than by the endpoint, or linking would become a way to attach one wallet to several accounts and multiply the allocation it exists to bound. Guesses already made on the synthetic account stay there, and `signer_wallet_address` is untouched... that is the payout address, and a link flow has no business quietly redirecting where winnings go.

- **A targeted push can no longer become a broadcast**: `sendNotification` honoured its `targetFids` argument on the Neynar rail and passed nothing to the Base rail, which selected every wallet-origin row... so the first targeted send anyone wrote (a winner nudge, a Superguess ping, an admin message) would have gone to the entire Base app audience. Nothing calls it that way today, which is exactly why it was worth fixing before something did: a push cannot be recalled, and this is the only channel these players have. The recipient list is now threaded through, an empty target list resolves to nobody rather than everybody, and the audience also includes **linked** players... after account linking a returning veteran keeps their Farcaster row while playing in Base app, so selecting only wallet-origin rows would have meant linking silently cost them their notifications. The audience resolution is a separate exported function because the sending path is hard-stopped outside production, correctly, and the half that can do damage has to be testable without faking production.

- **Base app players can earn the daily share bonus, and the endpoint that grants it is authenticated at last**: `/api/share-callback` read `fid` straight out of the request body, so anyone could POST any FID... the Neynar cast check was the only thing making that survivable, because you also had to have actually cast. A wallet player cannot cast at all, so their bonus has to be awarded on the share intent, and doing that without authenticating first would have turned the endpoint into an unauthenticated "+1 free guess for any FID" faucet pointed at the 5,303 dormant accounts from the round-28 wave. So the auth is the precondition, not a nice-to-have: a Farcaster player presents their Quick Auth token and their cast is still verified exactly as before, a wallet player presents their session and shares to X. The exposure is bounded by the rule that already bounds everyone... the award is idempotent per player per UTC day, so the ceiling is the same +1 either way. Four tests pin the boundary, all verified to fail against the old endpoint.

- **The one-address-one-player rule is declared where Drizzle can see it**: it existed only as an expression unique index in the migration, and `drizzle-kit push` builds from `schema.ts`... so a `push --force` could drop the constraint, after which nothing conflicts and one wallet could attach to several accounts and multiply the daily allocation the link flow exists to bound. Same trap as 0031's sequence and partial index. And redeeming a link code no longer spends it on a failure that is not the player's fault: the wallet check needs no code at all, so it runs first, and an already-linked wallet is answered with a session for the account it belongs to rather than an error about a link that already exists.

- **Bonus word and burn word finders get the same treatment**: both lists rendered their own `fid:${fid}` fallback and had no origin, so a Base App finder appeared unnamed and unbadged beside named Farcaster players. Both now go through the shared renderer, carry origin, and stop asking Neynar about synthetic FIDs.

- **The X share attempts the installed app**, via `twitter://post` on a programmatic anchor click, while ALWAYS opening the `x.com` tab as well. Both fire inside the click gesture: a delayed fallback sits outside it and popup blockers swallow it, which is how an earlier attempt turned the share into a dead button. A hidden iframe rather than a location assignment or an anchor click, because both of those navigate the top document and a scheme the host does not handle can replace the game with an error page... an iframe cannot touch the top document by construction. Reported from a device: Base App opens the https link in its own in-app browser rather than handing it to X... whether it honours the scheme is the host's decision, and this is the best a page can do without ever being worse than the tab alone.

- **The permanent archive names Base players too**: the round archive is never rewritten, so whatever it renders is what a round looks like forever... and it was writing wallet-native players in as `fid:1000000001` beside named Farcaster players. It now carries the display columns through both of its user lookups and renders through the same helper as everywhere else, returns each player's origin so the archive UI can badge them, and stops sending synthetic FIDs to Neynar (guarding on the *filtered* list, so a round played entirely by Base App players cannot call the API with an empty array).

  One structural fix came out of it: `player-display.ts` is imported by client components but was reaching `isWalletFid` through `users.ts`, which imports the database layer... that pulls Postgres into the browser bundle and fails the build on `fs`. The FID-range constants now live in `src/lib/wallet-fid.ts`, which imports nothing, and `users.ts` re-exports them so every existing import still works.

- **A Base App player has a name again**: they have no Farcaster account, so Neynar can only ever answer "no such user" and every name surface fell back to `fid:1000000001` with a placeholder avatar... including the stats panel a player opens about themselves. Their identity is resolved from the address SIWE already proved they control: `src/lib/basename.ts` reads the basename from the Base L2 resolver (verified against a live account, which returns `starl3xx.base.eth`) and then checks the name resolves back to that same address, because a reverse record is set by whoever controls the address and is a claim rather than a proof... without the round-trip a player could point theirs at somebody else's basename and appear as them on the leaderboards and in the archive, and `src/lib/player-display.ts` becomes the one place that decides how any player is named. The order is Farcaster username, then basename, then a truncated address... never `fid:NNN`, and never `user-<fid>`, which is the exact naming fingerprint the round-28 farm wave carried. Stored in its own columns rather than `users.username`, because two live consumers read that column as a Farcaster handle: the announcer prefixes it with "@" unconditionally, and tweet-mentions matches it against Farcaster handles, so a basename there becomes a broken mention on one network and an @mention of a stranger on the other.

  Avatars are best-effort by necessity: the on-chain `avatar` record is frequently unset even for players who plainly have a picture in Base App, because that image comes from Coinbase's own profile service rather than the chain. The fallback is a deterministic image keyed on the wallet, so it is stable and is what anyone else would generate for that address. Rows created before this heal on their next sign-in, so no backfill is needed.

- **Nothing in the app can hang on a Farcaster host that is not there**: every `sdk.actions.*` promise never settles off-host, and it neither resolves nor rejects, so a `catch` and a `finally` are both unreachable and any spinner set before the await stays up forever. Two of those were live traps in Base App. The share-for-a-guess modal disabled its own "Not now" while waiting on a composer that never opened, leaving a backdrop tap as the only escape. On the winner screen, the highest-stakes screen in the game, tapping the dead Farcaster share permanently disabled the X share beside it, which is the one a Base App winner could actually complete. `src/lib/hostActions.ts` now bounds every host action so a hang becomes an ordinary rejection that existing error handling already covers, applied across all nine call sites (six `composeCast`, two `viewToken`/`viewProfile`, and the capabilities probe behind every haptic). The bound for `composeCast` is deliberately three minutes rather than eight seconds, because it resolves when the player posts or dismisses, not when the host answers... a short bound would have rejected mid-compose on a real Farcaster host and cost the majority cohort their share bonus. The actual defence off-host is never calling it there at all. Two rules go with it: never set a spinner ahead of an unbounded await, and a pending action may disable its own control and nothing else.

- **The $WORD bonus modal could not even be dismissed** in Base App: its "Learn more" awaited `viewToken`, so the fallback *and* the `onClose()` after it were both unreachable. It now branches on the host first, like the Buy button, and opens the token's page on Base.

- **Shares go where the player actually is**: Stats, referrals and Wordmarks now open the X composer outside a Farcaster host, styled black rather than Farcaster purple, and pointed at `x.com/intent/tweet` rather than `twitter.com`... measured, the twitter.com URL 301s to the x.com one, and that redirect hop is exactly what stops iOS matching the universal link and opening the installed X app. Reaching the app is the OS's decision and not something a page can force: an attempt to force it with a `twitter://` scheme plus a delayed fallback was reverted before merge, because a delayed `window.open` falls outside the click gesture and is silently swallowed by popup blockers, and a scheme nothing handles can replace the webview with an error page... a share button that can unload a jackpot celebration is worse than one that opens a browser, and the winner card hides its Farcaster button there rather than offering a share whose only possible outcome is failure. Icons follow the destination. The two handles are now separate constants and never interchangeable... the X account is **@letshaveaword_** and the Farcaster account is **@letshaveaword**, so posting the Farcaster handle to X (which the winner card's X share did) tags whoever holds that name there, from a jackpot announcement.

- **The share bonus is hidden from wallet players until it has an honest answer**: the modal composes a cast and the bonus is only awarded once Neynar finds that cast, so a Base App player could satisfy neither half and was being offered a free guess they could not earn.

- **A sentinel identity can no longer burn a real player's daily wallet claim**: the reward gate allows one wallet to vouch for one player per day, and the broken sign-ins had claimed a player's wallet *as fid −1* before they ever got in. Minutes later they signed in properly and were told to buy $WORD they already held 72 million of. A claim held by a non-positive fid is now handed to the real player rather than honoured, so the lockout self-heals with no data surgery; a claim held by a real fid still blocks, unchanged.

- **"Add app" no longer appears where it cannot work**: `sdk.actions.addMiniApp()` never settles outside a Farcaster host — not resolve, not reject — so both the onboarding step and the post-guess install prompt stuck on "Adding..." forever in Base App, which stopped hosting mini apps on 2026-04-09 and has nothing to add. Both are now skipped unless a host is confirmed. The post-guess prompt was gated on `hasMiniAppInstalled === false`, which is true for *every* Base App player, so it fired for all of them.

- **"Buy $WORD" opens $WORD on Base**: a wallet-native player's wallet already lives in Base App, one tap from a trade, so sending them to a GeckoTerminal chart on a site they have no account with was the wrong end of "buy". The mini app path still uses the native Farcaster swap; GeckoTerminal remains the last-resort fallback.

- **A wallet-native player's own address stopped reading as an attempted wallet change**: the comparison in `/api/user-state` was case-sensitive, and the column holds both checksummed (Neynar) and lowercased (ours) forms — so every poll triggered a Neynar lookup for an FID Neynar has never heard of, a refusal, and a Sentry warning.

- **A sentinel row can no longer impersonate a wallet's account**: a test row from January (fid −1) held a real player's Base Account address, so every Sign in with Base linked them to fid −1 and minted a session the verifier refuses by its own `fid > 0` rule... sign-in reported success, every guess answered 401. The linkage query now ignores non-positive fids, `/api/auth/siwe` refuses to mint for one (loudly, to Sentry) as a second wall, and a one-incident admin endpoint clears the sentinel's stolen wallet address. Found by the new refused-token telemetry naming `claimedFid: -1` on the first event it ever recorded.

- **The Base App keyboard no longer floats below a gap**: the content column reserved room for the fixed keyboard with a constant, `13rem + env(safe-area-inset-bottom)`, while the keyboard sized itself with `max(1.5rem, env(safe-area-inset-bottom))` — one *adds* the inset where the other *absorbs* it. Base App's browser reports a 34px bottom inset and the Farcaster webview reports 0, so the two guesses agreed only in Farcaster; in Base App the column gave away space the keyboard never claimed, squeezing the wheel until its outer words clipped and opening a visible gap above the keys. The column now measures the keyboard and reserves exactly that, in every host, so the class of bug is gone rather than retuned.

- **Sign in with Base, done Base's way**: every Base App *and* Safari sign-in had been failing silently because the player's wallet is a Base Account smart wallet, and building the SIWE message ourselves then asking for a `personal_sign` never yields a signature that verifies for one. The wallet now constructs and signs its own message via `wallet_connect` with the `signInWithEthereum` capability, wrapped around our server nonce (prefetched while the sign-in card is visible, so Safari's popup blocker has no awaited gap to kill) and returning the ERC-6492-wrapped signature the existing viem verification accepts. The sign-in card carries Base's official `SignInWithBaseButton` as its one control... the supported doors are Farcaster and Base App, so there is deliberately no generic "other wallet" option, and the classic EOA dialect survives only as an internal fallback inside the hook. Sign-in refusals now report to Sentry with the ERC-6492 marker, so this class of failure can never again hide behind a `console.error`. The Farcaster mini app path is untouched.

- **A stale Base App webview can no longer keep a player on yesterday's bundle**: Base App resumes pages from memory, and on the morning after the session fix a device was still executing the pre-fix code — the fixed bug looked unfixed, and nothing server-side could tell which client had sent the request. The client's build sha is now inlined at build time (`NEXT_PUBLIC_BUILD_SHA`), every `/api/round-state` response carries the server's in an `x-lhaw-server-build` header (a header so the 204 no-active-round response has it too — deploys land between rounds by design), and `src/lib/buildFreshness.ts` compares them on the existing 15s poll. A mismatch found just after arriving reloads immediately (the resumed-page case, invisible to the player); a mid-session mismatch waits until the tab is hidden. Automatic reloads **hold** while anything is in flight that a reload would destroy — a pack or Superguess purchase between onchain payment and crediting, a share between composeCast and its callback, or letters sitting in the guess boxes. One attempt per sha is remembered in sessionStorage so a cache-hostile webview cannot loop, but a heap that survives its own reload call (the webview froze the navigation) may retry — the attempt only counts once it actually happened. Every authenticated request also carries an `x-lhaw-build` header now, so the next incident names the client version on its own.

- **A dead wallet session self-heals instead of stranding the player**: a 401 on a guess used to show "Your session has expired" while leaving the game on screen with a signed-in look — every further guess failed identically and nothing offered a way back (seen on device 2026-08-27). Now the client first reloads if it knows it is running stale code, and otherwise clears the dead session and returns to the sign-in card with the message, one tap from a fresh SIWE.

- **The game no longer flashes before the sign-in screen in Base App**: the mini-app probe renders a neutral boot screen while it runs instead of the game shell. The probe also stops paying the 1.5s Farcaster cold-start retry inside `CoinbaseWalletRN` — a webview that stopped hosting mini apps on 2026-04-09 and will never answer — cutting the stall from ~3.5s to ~1s, with a 5s hard stop so the boot screen can never be terminal.

- **The no-credential telemetry can now discriminate**: an *authentic* session token — HMAC-valid, merely expired — that is presented and refused reports as its own Sentry event (`[Guess] Session token presented but refused`), with the session cookie/header presence and the sending client's build in the extras. That event — and only that one — is flushed before the 401 goes out, because in a serverless function the runtime can freeze the moment the response is sent, which is how this morning's only diagnostic event was lost. The gate is authenticity, not token-shaped bytes (Bugbot's catch): garbage in the header lands with the bare zero-credential case, which stays fire-and-forget — it is reachable by anyone at line rate, and an awaited flush there would be a free 2-second hold per unauthenticated request.

### 2026-08-26 (during Round 34)

- **The Base App session never survived the round trip, so wallet players could sign in and never play**: sign-in set an HttpOnly cookie, Base App's webview accepted it, and then **never sent it back**. The player saw their FID, their $WORD balance and a full guess bar — all of which come from `/api/user-state?devFid=…`, which needs no cookie — and then every guess arrived at `/api/guess` with no credential at all. Nothing server-side could fix it: the credential never left the device.

  `/api/auth/siwe` now also returns the session token, the client holds it and presents it in an **`x-player-session`** header, and `resolveRequestFid` tries the cookie first and the header second. Reproduced under the exact failing condition before and after — sign in, **discard the cookie**, then guess with the header alone: `200 {"status":"incorrect"}`; with neither, the `401` players were actually getting.

  **The cost, stated rather than buried:** a token the client can hold is a token a script can read, which `HttpOnly` exists to prevent. It is taken knowingly, because `HttpOnly` protects nothing when the cookie is never transmitted, and the cookie is still set and still preferred wherever it works — ordinary browsers keep the stronger guarantee and only cookie-hostile hosts fall back. What the token authorises is bounded: playing as yourself. It cannot move funds, because every purchase is an onchain transaction signed by the wallet, not by this.

- **Base App players can be reached at all now**: they have no FID, so Neynar cannot notify them — this was not a degraded channel for them, it was no channel. `src/lib/base-notifications.ts` targets Base's API **by wallet address**, which needs no translation because a wallet-native player's identity *is* their address. Every existing `notify*` helper fans out automatically: the hook sits inside `sendNotification`, so round start, daily reset, round resolved, Superguess and custom sends all reach both audiences with no caller changes.

  It sends to the wallets we already hold rather than first asking Base who has opted in. The user-list endpoint pages at 1000 with 3.1s between requests to respect a shared 20/min limit — fine for an admin tool, far too slow inside a serverless request a round start is waiting on. Sending direct costs one indexed query and, at any scale this game has, one request, and Base reports per address when someone has not pinned the app. Only `identity_origin = 'wallet'` rows are targeted: a Farcaster player's `signer_wallet_address` is a Neynar-verified EOA with no relationship to Base App.

  **The hard stop is shared, not copied.** `notificationsAreActive()` is now exported from `notifications.ts` and imported here, and `setup-guards.ts` empties `BASE_NOTIFICATIONS_API_KEY` alongside the Neynar credentials — assigned empty rather than deleted, for the same `dotenv.config()` reason documented there. A broadcast to every wallet that pinned the app cannot be recalled, and on 2026-08-14 one sourced `.env.local` disarmed several of these guards at once. Four tests assert this channel stays silent from a test run, from dev, and without a key.

- **"Something went wrong" was hiding every reason a guess could fail**: `pages/index.tsx` handled rate limits, user-quality blocks and operational errors, then threw a bare `Failed to submit guess` for everything else. So a **reward-gate refusal** (403 `REWARD_GATE_LOCKED`, which says exactly what the player needs) and a **lost session** both rendered as the same opaque message. Found while debugging why a Base App player could sign in, see their $WORD balance, and then fail on every guess: the failure was indistinguishable from a server fault, to the player and to us. The client now shows the gate's own message, prompts re-sign-in on a 401, and otherwise repeats whatever explanation the server gave rather than replacing it.

  The server end was worse. A request with no credential fell through to `400 "Authentication required: provide frameMessage or signerUuid"` — copy written when every player was a Farcaster player, and meaningless to a wallet player whose cookie expired. It is now a `401 AUTHENTICATION_REQUIRED` with actionable copy, and it reports to Sentry, because that response is now the signature of a lost session rather than a malformed request. The `AUTHENTICATION_REQUIRED` body also stopped saying *"Please open this app in Warpcast to play"*, which is wrong for someone already in the right place.

- **Two dev-mode auth bypasses closed**: `guess.ts` computed `isDevelopment = !process.env.NEYNAR_API_KEY || isDevModeEnabled()` and used it to decide whether a caller-supplied `devFid` could be believed. **One unset environment variable would therefore have let any request authenticate as any FID** simply by putting it in the body. Unreachable in practice — the key is set, and it is a required var — but it is a complete authentication bypass one misconfiguration away, and it was preserved deliberately through the `resolveRequestFid` refactor so that a security change would land on its own rather than hidden inside a refactor. The predicate is gone, along with the `trustDevFid` option that carried it, so there is no longer a way to reinstate it: an unset API key says nothing about whether the caller is a developer.

  `src/__tests__/guess-retry-dedup.test.ts` reached the guess path by *exploiting* that bypass — it deleted `NEYNAR_API_KEY` on purpose. It now presents a resolved credential instead. Switching it to real dev mode was tried first and does not work: dev mode also enables the fixed-solution bypass, and the file's word is CRANE, so every guess returned `correct` before reaching the code under test.

  **`/api/game` had the same shape, worse.** It is documented as *"Dev Mode Only"* and has no callers — it returned 500 for six weeks during the ETH-to-$WORD gap and nobody noticed — but it gated on `!process.env.NEYNAR_API_KEY` and refused only when a `devFid` was *also* absent. In production anyone could pass `?devFid=<someone else>` and read that player's free and paid guess balances, with `fid` taken straight from the query and never verified. Low severity, being a read of numbers that are not secret, but an unauthenticated read of another player's state. The endpoint now answers only in dev mode; the unreachable production branch was removed rather than left behind a guard.

- **The guess-pack endpoint authenticated nobody, and now prefers a credential**: `purchase-guess-pack.ts` read `fid` straight from the request body and believed it — a known hole, tracked in a comment in that file, which named the fix as *"an authenticated caller, the way `pages/api/guess.ts` verifies a Farcaster QuickAuth JWT"*. The residual attack: an attacker holding an FID Neynar has no record of plants a victim's wallet through the last-resort branch in `user-state.ts`, watches for the victim's purchase transaction, and claims it first. `pack_purchases.tx_hash` is unique, so it is a front-run — first submitter wins and the buyer loses their packs.

  A verified credential now wins whenever one is presented, via the same `resolveRequestFid` the guess path uses, and a body FID that disagrees with it is logged to Sentry rather than silently overriding. The body `fid` is still accepted as a **phase-1 fallback**: `GuessPurchaseModal` sent no token, so requiring auth outright would have broken every purchase from a client that had not reloaded. The fallback is logged so the unauthenticated share is measurable, and phase 2 deletes it once that reaches zero. The modal now forwards its Quick Auth token; a wallet player needs no client change at all, since their HttpOnly session cookie rides along with the fetch.

  **The payer binding is now enforced — for wallet players only.** A wallet-native player's identity *is* their address: SIWE proved it and `/api/auth/siwe` wrote that same address to `signer_wallet_address`, so `verification.payer` and the account on file cannot legitimately differ and a mismatch is someone claiming a payment that is not theirs. It stays unenforced for Farcaster players, whose `signer_wallet_address` is a Neynar-verified EOA while the payment may come from a Base Account — rejecting there would take an honest buyer's ETH and give nothing back, which is the same failure the underpayment floor already refuses to risk.

- **Base App groundwork: a player can now be a wallet instead of an FID**: Base App stopped hosting Farcaster mini apps on **2026-04-09** and treats every app as a standard web app — wallet for identity, SIWE for auth, manifests ignored. A Base App user opening the game hit the browser fallback and was told to go get Farcaster. What made this affordable is that the **reward gate already made the FID redundant as a defense**: `checkPlayEligibility` reads `getEffectiveBalanceChecked(users.signer_wallet_address)`, so the $3 bar has always been per-*wallet*. Neynar reputation gates nothing in the live path — `userScore`/`spamScore` reach only one leg of a flag-disabled cluster gate, an error-string map, and the Farm Monitor's human-review column — and the round-32 wave carried real-shaped names and high scores straight past it. A farm needs N wallets × $3 either way, so wallet identity costs roughly nothing in sybil resistance.

  Landed this pass: `src/lib/playerSession.ts` (SIWE session, mirroring `adminSession.ts`), `pages/api/auth/siwe.ts`, `upsertUserFromWallet` in `src/lib/users.ts`, and migration **0031**. Wallet players get a **synthetic FID ≥ 1,000,000,000** from a sequence rather than a nullable `fid`, so all 24 fid-keyed tables and 85 fid-reading endpoints keep working untouched; it is above the real FID range (~1-2M), below the `integer` ceiling (2,147,483,647), and **positive**, because eleven endpoints validate `fid <= 0` and would have rejected a negative scheme at the door. Uniqueness is a **partial** index on `lower(signer_wallet_address) WHERE identity_origin = 'wallet'` — a blanket constraint could have failed outright on existing rows, since that column is a Neynar snapshot that has never been guaranteed unique across FIDs.

  Two things worth calling out. **An existing player who signs in from Base App lands on their own account**: `upsertUserFromWallet` looks for *any* row holding the address before minting, so a wallet that Neynar already recorded as verified resolves to that FID with its guesses, Wordmarks, XP and grandfathering intact, instead of silently starting over behind a second empty account. And the SIWE verifier passes a **viem public client**, because Base Accounts are smart contracts returning ERC-1271/6492 signatures that `ecrecover` cannot validate — an EOA-only verifier would have worked flawlessly against a test private key and rejected essentially every real Base App user.

  Migration 0031 was tested against a replica of the production `users` table seeded with the shapes that table can actually hold — one wallet held by three different FIDs, mixed casing, NULL wallets. A **blanket** unique index on `lower(signer_wallet_address)` fails outright on that data (`could not create unique index ... is duplicated`), which is the concrete reason the index is partial. The migration itself applies over it cleanly, is idempotent across repeat runs, and the column add is metadata-only (0.65 ms, no table rewrite). **Applied to production 2026-08-26**, before the code that reads the column ships — which is the safe order: Drizzle builds an explicit column list from the schema, so a column the deployed code does not know about is simply not selected, whereas code deployed ahead of its column breaks every full-row read.

  **One resolver for "who is making this request?"** `src/lib/requestAuth.ts` now answers it, and `guess.ts` and `superguess/purchase.ts` both call it. Three endpoints ran three different chains — six branches, four branches, and *none* — and adding a fourth kind of caller to each separately is how three chains become four. The order mirrors `guess.ts` exactly: dev → Quick Auth → unverified-miniAppFid refusal → player session. The session slots in **after** the miniAppFid refusal, not before, so that security-sensitive branch keeps its exact prior behaviour; a real Base App client never sends that field, so wallet players lose nothing. Signer and frame verification stay at the call sites, because they hit Neynar and only two endpoints use them. `superguess/purchase.ts` keeps answering a bad token with its bare `401 Authentication required` — sharpening a client-visible error is a separate decision from moving the code that produces it.

  Two things fell out. Removing the two `quickAuthClient.verifyJwt({ token })` calls **dropped the repo's TypeScript error count from 171 to 166**: that package version's published types declare the parameter as `RequestQueryParameters`, so the documented call has never typechecked anywhere it appears. And `guess.ts` computes `isDevelopment = !process.env.NEYNAR_API_KEY || isDevModeEnabled()`, meaning **a missing `NEYNAR_API_KEY` alone makes any request carrying `devFid` authenticate as that FID** — a full auth bypass from one unset variable. It is not reachable today (the key is set, and it is a required var), and `guess-retry-dedup.test.ts:139` deliberately deletes it to reach that path, so the behaviour is load-bearing in the suite. It is preserved exactly, passed in as an explicit `trustDevFid` option rather than reproduced inside the resolver, so it is visible and one line to remove. Tightening it is a security change and should land on its own.

  **The wallet door is open.** Outside a Farcaster host the browser fallback is no longer a dead end that tells you to go and get Farcaster: a player who signs a SIWE message falls through to the real game. `useWalletSignIn` connects, fetches a nonce, signs and exchanges it at `/api/auth/siwe`; `/api/auth/me` is how the client learns whether it holds a session at all, since the cookie is HttpOnly by design and page scripts cannot read it. `effectiveFid` resolves Farcaster first, then the wallet session, matching `resolveRequestFid`'s server-side order — the two must never disagree about who is playing.

  The wagmi config had **only** the Farcaster connector, so nothing could connect outside a Farcaster host. It now also carries `injected` (Base App is a webview that injects an EIP-1193 provider) and `baseAccount` (plain web, where there is no injected provider). Both ship inside `wagmi/connectors`, so no new dependency. Farcaster stays first in the list, and adding connectors changes nothing about what auto-connects — wagmi only reconnects to one the player previously chose.

  Guess submission needed no client change: a wallet player's credential is the cookie, which a same-origin fetch sends on its own. The absence of a branch there is the design, and is commented as such.

  **Not yet wired**: the Farm Monitor's `.base.eth` leg (which classifies basenames as a farm shape and would flag organic Base traffic), and `purchase-guess-pack.ts`, which authenticates nobody at all — it reads `fid` straight from the request body. That last one is a known, documented front-run risk on `txHash`; closing it needs a coordinated client change and its own judgement call on the payer binding, so it is deliberately not riding along in this refactor.

- **A successful Base App launch would have tripped the farm alarm**: the Farm Monitor's name leg counts a NULL username as suspicious, and a wallet-native player has no Farcaster account, so `upsertUserFromWallet` leaves `username` NULL by construction. Every Base App player was therefore a farm signal — not merely the ones with basenames. With the thresholds as they stand (`nameLegMinNew` 40, `suspiciousNameShare` 0.5), **forty Base players arriving in one round is a 100% suspicious share and an automatic `farm-signature` verdict**, and an alarm that fires on success stops being read. The `.base.eth` clause is the same problem one step on: basenames were a farm shape when only a wave had them, and are ordinary once Base is a supported door. The name leg now evaluates Farcaster-origin rows only, `coalesce`d so a guess with no user row still reads as suspicious exactly as before. They are **not** unwatched — the funding leg covers them, and that is the leg that caught the round-32 class, which had real-shaped names and high scores and was invisible to name checking. `walletNative` / `newWalletNative` are reported as their own cohort so Base players stay visible in the report while being out of the verdict.

- **Follow-up to the Farm Monitor fix in #275, caught by Bugbot**: ending the claim window at `resolved_at ?? now` was wrong for a **cancelled** round, which never gets a `resolved_at` — the kill switch (`operational.ts:294`) and the seeding-failure path (`rounds.ts:268`) both set `cancelledAt` and leave `resolvedAt` null. That ran a cancelled round's window from its cancellation to the present, counting every claim since and pointing the funding trace at other rounds' wallets: the same misleading all-clear, reintroduced from the other direction. Writing the test then exposed a second bug — the bounds were computed in JavaScript as UTC, while `created_at`/`started_at`/`resolved_at`/`cancelled_at` are naive `timestamp` columns written by `DEFAULT now()`, which records the **database server's** local wall-clock. A local Postgres on Central stored a claim at 16:41 whose own `now() AT TIME ZONE 'UTC'` read 21:41, and the window matched nothing. Production is UTC, so it would have been right there by luck and wrong anywhere else. Both bounds now compute column-to-column in SQL.

- **Builder code `bc_lul4sldw` now covers Superguess, and four sites are documented as deliberately uncovered**: `useSuperguessPayment.ts` passed no `dataSuffix`, so every Superguess — a real revenue transaction — went unattributed while pack purchases and all ten staking paths carried it. Fixed. The other four bare `sendTransaction` calls **must stay bare** and now say so in place: `jackpot-contract.ts` tops up a contract whose `receive()` only fires when `msg.data` is empty and which has no `fallback()`, so appending a suffix there **reverts the top-up**; `refunds.ts` and `airdrop.ts` pay players, which is not user activity and risks reverting against the smart wallets Base App users have; `WalletSection.tsx` funds the operator wallet from the treasury, which would inflate the metrics with our own transfers. A test pins the suffix by decoding it backward from the tail (marker → schemaId → length → `bc_lul4sldw`) and asserts the client and server copies of the literal have not drifted apart.

### 2026-08-22 (during Round 34)

- **The FAQ was two Wordmarks out of date, and still advertised a fee split**: the "What are Wordmarks?" answer listed 10 of the 12 marks in `WORDMARK_DEFINITIONS`, missing **💅 Early Adopter** and **🚩 Trailblazer** — the two that shipped with round 34 and have been visible since launch night (`/api/user/wordmarks` reveals them once any `prize_currency = 'word'` round exists, which is permanent now). The list is rebuilt in Lexicon order and checked against the definitions, and it gains the part players actually ask about: **how sharing works**. Tap any Wordmark in Stats → Lexicon, held or not, to see how it is earned and how rare it is; the ones you hold carry a Share button that opens a cast pre-filled with the mark, how you earned it, and how many *other* players hold it. Unearned marks show the goal instead. The **"$WORD fee distribution"** entry is deleted outright. Copy in the rewritten block follows the house rules the rest of the file predates: no em dashes (list separators are colons now), curly apostrophes, and "Wordmark" capitalized — including the "View your Wordmarks collection" line that had it lowercase.

- **Farm Monitor reported 0 reward-gate claims for a round in which the gate was live and passing players**: the count filtered `reward_gate_claims` on `round_id`, and that column is NULL for very nearly every row. Claims are keyed `(date, wallet)` and written with `onConflictDoNothing`, so `round_id` records only what the **first** check of that wallet-day happened to know — and that check is normally round-*less*, because `/api/user-state` and the daily allocation both call `checkPlayEligibility` with no round in scope, on app open, long before any guess. The row lands stamped NULL, the guess path's round-scoped insert conflicts and changes nothing, and `where round_id = N` matches nothing for the rest of that day. Both claim queries now bound on `created_at` against the round's own `started_at`/`resolved_at` window; the columns are naive `timestamp` on both sides, so no timezone conversion applies. **The same filter sat on the enrichment wallet set**, which is why ticking "Trace $WORD funding" could spend the Blockscout budget walking an empty list and return "no shared funder" — a clean bill of health it had not actually earned. The schema comment on `roundId` now says outright not to filter per-round reports on it, and a test asserts the count against a row written NULL exactly the way production writes them (verified failing against the old query at 0, passing at 1).

  Round 34's report is unaffected in substance: 128 of its 129 guessers are grandfathered, so only one player was ever subject to the bar.

- **The Superguess announcement is retired from onboarding**: the "🔴 NEW: Superguess" modal was a feature-launch notice gated on one condition, `!hasSeenSuperguessAnnouncement`, so its remaining audience was exactly the people it was never written for — new players, plus the long tail who had not opened the app since Milestone 15. A "NEW:" banner about a feature that has been live for rounds reads as noise to a first-time player, and it sat *between* the OG Hunter thanks and the round-34 announcement, so an OG Hunter arriving on launch night got three modals in a row before reaching the game. The step is gone from `OnboardingManager`, the component is deleted, and the `superguessAnnouncement` key is dropped from `/api/onboarding/mark-seen` and `/api/onboarding/status`. The flow is now How It Works → OG Hunter thanks → round 34, each still gated as it was. `SuperguessBar` remains the in-context teacher: it is on screen when a Superguess is actually purchasable, which is where the explanation belongs.

  **No migration.** `users.has_seen_superguess_announcement` stays in the schema and in the live table. Dropping it would need SQL run by hand for no gain, and the column is the only record of who saw the announcement while it ran.

### 2026-08-19 (during Round 34)

- **The round modal claimed every bonus word paid 5M, and so did the API**: the same stale constant as the cast, one layer deeper. `getBonusWordWinners` hardcoded `tokenRewardAmount: '5000000'` rather than reading the claim, so the API reported 5M no matter what was transferred, and `RoundArchiveModal` printed "5M $WORD each" above the list. The claim rows had the truth the whole time: **128 finds at exactly 5,000,000 across the entire ETH era, then 5,701,254** for round 34's first find. So the label was right until round 34 and has been wrong ever since, drifting further with the price. The API now returns `rewardWei` read from `bonus_word_claims`, each finder's row shows what that find actually paid (`→ 5.70M $WORD`, the same arrow idiom the Top 10 uses so it cannot be misread as a balance), and the header states the rule for the era being viewed rather than a number: **"$1.50 of $WORD each"** for word rounds, **"5M $WORD each"** for the archive. The burn-word line beside it keeps its literal 5M, because `BURN_WORD_AMOUNT` genuinely is a fixed constant.

- **The info bar's ≈$ was frozen at the seed price for two days, and the cache was innocent**: the live-price work shipped on 2026-08-17 never took effect. Vercel KV returns the cached price as a **string**, and `cacheGet<number>` is an unchecked generic, so neither the compiler nor the runtime objected. A string turned out to be worse than a miss: `"0.0000002862" > 0` passes by JS coercion, so the guard let it through to `usdPriceToE18`, which refused it and **threw** — landing in `wheel.ts`'s `catch`, whose only behaviour is "keep the frozen seed snapshot". Three correct-looking pieces (a defensive positivity check, a swallowing catch, an unchecked generic) composed into a permanent silent fallback with no error anywhere. On round 34 that showed **$24.26 against a real $27.33**, about 11% low, while Redis held the right price the whole time (verified: the key was warm and current to the cent). Coerced now at `getCachedWordPriceUsd`, the single choke point every consumer passes through, with `Number.isFinite` so junk becomes a null instead of a throw. `daily-limits.ts` reads a cached number the same way but guards with `typeof cached === 'number'`, so it degrades to a live read rather than breaking — it is the check `word-oracle` was missing.

- **A slow handshake no longer strands a real player on the landing page**: `pages/index.tsx` decided whether it was running inside a mini app by racing `sdk.context` against a 2-second timeout. Losing that race set `isInMiniApp` false, the effect had an empty dependency array so nothing ever re-checked, and the browser fallback replaced the game **for the rest of the session** — which is why the game appeared to open and then "revert to the splash screen": the fallback renders `LHAW-icon.png`, the same artwork as the host splash. The in-a-host question now comes from `useIsInMiniApp` (PR #206), which re-asks after a false and caches only a confirmed true, exactly as the SDK's own probe does. The 2-second race stays, but only as a **rendering budget**: the losing promise is no longer discarded, so a context that arrives late still applies. That last part matters more than it looks — the late path runs the same `applyContext` as the fast path, so a slow host keeps its notification tracking, its cast-embed referral capture and its Quick Auth token instead of silently losing all three. **This does not make the game playable in Base App**, which stopped being a Farcaster mini app host on 2026-04-09; there is no Farcaster context there to arrive late, so the fallback is the correct render until the game can identify a player by wallet rather than FID.

- **The tweet crosspost can now @mention the player, because it finally knows which account is theirs**: `convertToTwitterText` has always stripped the @ from player mentions, and that was right — Farcaster usernames and X handles are separate namespaces, so "@presidojay1" on X reaches whoever holds that name there. Sampling 15 of the names we have cast found **14 live X accounts belonging to other people**, one with 105,653 followers and one a spam account. Stripping was safe and it cost us the mention for every player who does have an X account. `postTweet` now resolves those names through walletlink.social and restores the @ **only** for a handle verified to still reach somebody: of the three players in the first live test, two kept their @ and one fell back to a plain name, because their real X handle is a different string from their Farcaster name and that account is no longer reachable. Resolution happens inside `postTweet` rather than at the eight announcer call sites, so a new announcement gets it without anyone remembering to ask, and every failure path — no key, timeout, HTTP error, unknown shape — returns an empty map, which is byte-for-byte the plain-name output this code produced before. Handles cache on `users` with a 7-day TTL and a `x_checked_at` that is null until a lookup succeeds, so a failed lookup is never recorded as "this player has no X account". Ten tests pin the fallback in place, including the empty-map case that a failed lookup produces.

- **The bonus-word cast announced a number the game had stopped paying**: `announcer.ts` hardcoded *"won 5M $WORD"* into the post — the rounds 1–33 fixed reward. Since round 34 a bonus word pays **$1.50 priced by oracle** (about 5.86M at the reference price, moving with the market), so every bonus-word cast and its cross-posted tweet has misstated the transfer since launch night. `announceBonusWordFound` now takes the awarded wei and renders it with `formatWordAmountCompact`, the same three-significant-digit helper the round modal and archive use, so a number in a cast matches the number in the app. The parameter is **required rather than optional** on purpose: an optional one defaulting to 5M would silently recreate the bug, whereas a required one makes the compiler reject any caller that does not say what it paid, and `guesses.ts` passes the exact variable that funds the transfer. The burn-word cast beside it keeps its literal 5M, because `BURN_WORD_AMOUNT` genuinely is fixed. Two tests pin it, including the oracle-down path, which degrades to the legacy 5M rather than denying an earned reward.

### 2026-08-18 (during Round 34)

- **The app-store listing still advertised ETH, and not because anyone forgot to update it**: the Farcaster manifest's `description` was migrated to `$WORD` back in PR #203, and that edit is precisely what broke it. Farcaster's `descriptionSchema` rejects the sigil — *"Special characters (@, #, $, %, ^, &, \*, +, =, /, \\, |, ~, «, ») are not allowed"* (`@farcaster/miniapp-core/src/schemas/shared.ts:34`) — so `domainManifestSchema.safeParse()` has returned INVALID on every re-read since, and the directory kept the last record that parsed: the ETH one. Verified by running the repo's own installed validator against the committed file, before and after. The description now says "win WORD tokens" and the manifest validates. The ban covers `description`, `subtitle`, `tagline`, `ogTitle`, `ogDescription` and `tags`, so **no manifest field can ever carry `$WORD`** — the sigil that is mandatory in player-facing copy is illegal here. Farcaster does not re-read on its own schedule reliably: after this deploys, force it in the manifest tool (`farcaster.xyz/~/developers/mini-apps/manifest`).

- **The admin panel now reads in one timezone, and two of its panels work for the first time**: chasing "admin says 1 pack purchase, the game says 6 packs" found no bug in either number — one counts transactions in a Central day, the other counts packs across a round — but it did expose that the panel had no consistent notion of a day at all. Day buckets came from `analytics_events` in Central, every other table bucketed in UTC, and the rendered timestamps used whatever timezone the *viewer's browser* was in, which looked right only because the admin sits in Central. **75 sites** across 9 analytics endpoints and 11 components now resolve to `America/Chicago`, through two shared helpers (`src/lib/reporting-time.ts` for SQL, `formatCentral*` in `components/admin/format.ts` for rendering) rather than per-file conversions. Times are labelled **CT**, not UTC.

  The trap this closes is that `created_at AT TIME ZONE 'America/Chicago'` runs **backwards** on a `timestamp without time zone` column: it reads the stored value as if it were already Central and converts it *to* UTC, a ten-hour error. Exactly five columns in the schema are `timestamptz` (`analytics_events.created_at`, `og_hunter_cast_proofs.verified_at`, `user_badges.awarded_at`, `users.added_mini_app_at`, `xp_events.created_at`); every other one needs the double conversion. A second trap sits behind it: `AT TIME ZONE` on a bare `DATE` silently casts through the *session's* timezone first, so the same expression returns a different instant on a differently configured server. Both now live inside helpers instead of in each caller's head.

  **Found along the way, unrelated to timezones: `/api/admin/analytics/retention` and `/api/admin/analytics/cohorts` returned HTTP 500 on every request.** Both selected `guesses.user_fid`, a column that has never existed — the table has `fid` — and `cohorts` also called `EXTRACT(EPOCH FROM (date - date))`, which has no integer overload. The Retention and Cohort Retention panels have been empty for as long as they have been deployed. Raw SQL is invisible to TypeScript and no test ever executed these queries, so nothing caught it. `src/__tests__/admin-analytics-smoke.test.ts` now runs all nine analytics endpoints and asserts each one answers, verified by failing against the shipped code and passing against the fix.

  **Bugbot caught the hole in the sweep**: the DAU, WAU and free-vs-paid charts do not build their own SQL, they `SELECT * FROM view_dau` / `view_wau` / `view_free_paid_ratio`. Those three endpoints contain no date expression at all, so a search for date handling never surfaced them, and the views bucket with a bare `date(created_at)` — which on a `timestamptz` column truncates in the *session's* timezone. The client filter was cutting Central days out of UTC-labelled bars. All three now build their buckets in code with the shared helpers instead of reading the views, so the fix ships with the deploy and needs no manual DDL. `view_jackpot_growth` and `view_referral_funnel` bucket the same way and have no callers at all.

  **Numbers will move, and that is the fix working.** Day buckets shift for anything that happened in the Central evening (a guess at 20:00 CT was being filed under the next day; on local data one chart moved 2,329 guesses out of one day and 2,548 into another). Seven-day averages were computed over a rolling 168 hours cut into calendar days, giving eight buckets with two of them fractional, and now cover seven whole Central days. Cohort weeks start Monday midnight Central rather than Monday 19:00 Sunday Central. Session metrics rise, because a 6:30pm–7:30pm session was being split in two at UTC midnight. The 11:00 UTC daily guess reset, round timing and every contract call are untouched: this is reporting, not game logic.

- **`baseBuilder.ownerAddress` added to the manifest, ahead of needing it**: Base Dashboard proves domain ownership one of two ways, and its own shipped error strings name them — *"Please make sure that you have added {address} to the `baseBuilder.ownerAddress` field in your farcaster.json file"*, or the `<meta name="base:app_id">` tag already served from `_document.tsx:27`. The field is set to `0x0Fc0F78f…`, the address `starl3xx.base.eth` resolves to. Note this is the one part of `farcaster.json` Base still reads: discovery moved to Base.dev on 2026-04-09, but ownership verification did not. Validated against `domainManifestSchema` before committing — the schema accepts the extra top-level key, which is not something to assume after the `$WORD` incident above.

- **A listing description that describes the actual game**: while the old one was busy being invalid, it was also just a summary. The store entry now leads with the mechanic nobody else has — *"Massively multiplayer word hunt! Wrong guesses are eliminated for the whole board and the first one to find the secret word wins the WORD token jackpot"* (151 of the 170 characters allowed). "WORD token jackpot" rather than the bare "WORD jackpot" the sigil ban would otherwise force: in a game about words, "wins the WORD jackpot" reads as a jackpot *of words*, which is exactly the ambiguity the `$` normally resolves.

### 2026-08-17 (before Round 34)

- **Reward-gate balance reads retry once**: a transient RPC failure (this morning's Sentry pair: a non-JSON RPC response body → "[RewardGate] Balance undetermined — failing open") is a free pass through the gate by design — fail-open is correct and never cached, but each blip was one free pass. The balance read now retries once after 400ms before declaring undetermined; a second failure still fails open, loudly, exactly as before.


- **The info bar's ≈$ tracks the live market**: the round's USD headline was frozen at the seed-time price snapshot, so a market-cap jump showed in the $WORD sheet but never in the bar. The seed itself stays frozen at its $20 target — all payout and seeding math still uses the round's stored snapshot — but the bar's display now prices the pool at the live oracle price, redis-cached for ~5 minutes (one external fetch per TTL across all players, zero added latency on the poll), with the seed snapshot as fallback so the bar never blanks.


- **The launch tweet mystery, solved**: Typefully 403s *direct* publishing of X posts containing URLs ("blocked by X policy") — which is every announcer cast, and why the round-34 launch tweet silently died while a URL-free manual test sailed through. Caught red-handed in the function logs on a manual admin post, then verified against the Typefully API live: a *scheduled* publish accepts URLs fine. `postViaTypefully` now schedules ~2 minutes out instead of `publish_at: 'now'`, and the test suite pins the regression (`publish_at` must never be `'now'`).


- **Guess-log checkpoints post again**: the checkpoint cron failed on every run since round 34 started — the DB's guess log is 1-based, the GuessLog contract's contiguity is 0-based, and the first `postRoot(round 34, from 1, …)` revert `NonContiguous(expected 0, got 1)` was sitting in the function logs. The conversion now lives at the contract boundary (post `fromIndex-1..toIndex-1`), the reconciliation compares the contract's leaf count directly against the local last-committed index, and the Merkle roots are untouched (leaves hash the 1-based data both when posting and when verifying).


- **Round modal rounds its $WORD numbers**: the Round #34 popup's header and split tiles now use the info bar's compact three-significant-digit form (78.7M / 63.0M / 3.94M / 7.87M) instead of nine-digit walls, and the Top-10 estimated payout renders as "→ 1.50M $WORD" instead of "(1,495,474 $WORD)" — the parenthesized form read as the player's balance. ETH rounds 1–33 keep their exact historic rendering.


- **Sepolia simulation hard-blocked in the $WORD era**: the legacy simulator creates a real ETH round in the prod database and announces it — which is exactly what happened when it ran on launch prep day: a phantom "Round #34" went publicly live, the bot cast it, and six real players guessed before the round was purged and the id sequence reset. The endpoint now refuses while the word economy is configured, `createRound` gains a `skipAnnounce` option so no drill can ever cast again, and the winning-guess failure that left the round stuck turned out to be winner-eligibility working as designed (the gate blocked the seconds-old fake account). A word-era simulator is a post-launch project.


- **No countdown between rounds**: the between-rounds bar says "Next round starting soon… Could be any moment 👀" instead of counting down, and `/api/next-round` stops returning the timestamp entirely (a boolean `nextRoundPending` replaces it) — hiding the timer in the UI would mean nothing while the public API handed the exact start time to anyone polling it. The point is the Trailblazer Wordmark: the first guess of a round should go to whoever shows up, not whoever camps a timer.


- **Bonus/Burn Fuel tile in Balances Overview**: the Treasury tab's top grid now shows WordManager's availableForGames beside Jackpot Fuel, so both $WORD funding gauges — what seeds jackpots and what pays bonus/burn/top-10 rewards — read side by side at a glance.


- **Round 34 announcement modal, final copy**: the user's own wording for all three cohort variants — "The jackpot and prizes (bonus words, Top 10) now pays out in $WORD, the game's native token"; grandfathered players read "You're in free since you played before rounds were botted"; Early Adopters additionally get "We also comped you the Early Adopter 💅 Wordmark for playing before the bots arrived"; "Let's have a word! 👉". Applies the day's copy rules (no em dashes, Wordmark capitalized), which an earlier pass had already enforced.


- **Admin tools finish the era migration**: the onchain Purchase Events explorer now queries WordPackSales (packs + Superguesses, with a Product column) alongside the legacy JackpotManager, so it stays current from round 34 instead of silently reading empty. The Jackpot Runway simulation models the $WORD tranche — rounds of seed funding from WordJackpot unallocated, offset by oracle-priced pool credits — instead of reading a dead ETH pool as zero and crying critical. The incident summary paste names the round's prize ("Prize: 78M $WORD") via a new `activeRoundPrize` on the status feed. The Economics tab drops its rolling 30-day window: the ETH era ended at round 33, so the tab is now that era's permanent, all-time record. And a successful archive auto-resolves the round's stale error rows — 377 unresolved rows from the long-fixed Dec 2025 Date-corruption incident were making the Round Archive tab read as a standing emergency (cleared in prod).


- **Admin era sweep (launch blocker included)**: the admin Start Round endpoint ran the full ETH seed preflight unconditionally — seeding the dead JackpotManager with real ETH and able to refuse round 34 over a meaningless shortfall. It now skips seeding entirely in the word era and verifies the operator against WordJackpot. Also: the seed-jackpot GET era-guarded; the legacy contract's diagnostics verdict reads "not used for round starts" instead of a contradictory green; the header $WORD pill requires all three contracts (amber + missing-var tooltip when partial); stuck-round diagnosis reports the round's real currency and reads the round's own contract; the corruption detector learns the $WORD columns; era labels on the ETH airdrop card, archive totals, and analytics revenue.


- **Wordmark popup polish**: Baker's Dozen and Encyclopedic now show the round they were earned in — new awards stamp it, existing holders get it derived from the award time. "Participated in the OG Hunter pre-launch campaign"; no em dashes in UI copy; Wordmark capitalized in the share cast.


- **Treasury tab enters the $WORD era**: Balances Overview drops the dead ETH seed model (Next Seed bar, 0.02 ETH target, treasury/operator auto-top-up copy) for a word-era grid — Jackpot Fuel (WordJackpot unallocated), Live Pool + carry, Pack Sales ETH awaiting withdraw, Pending Refunds — with a treasury-wallet line (ETH + $WORD tranche source) and an ETH-era leftovers note that only appears while anything remains to sweep. Fund Operator Wallet is reframed as gas-only (the operator never fronts a seed anymore; thresholds drop to gas scale). WordManager funding becomes **$WORD across contracts**: WordManager (staking + per-round rewards), WordJackpot (unallocated/pool/carry/claims), and the treasury tranche in one card — plus the bonus-words switch, relocated from the retired "💬 $WORD management (legacy)" card because it is NOT legacy: createRound still reads that onchain flag at every round start. The legacy card's withdraw UI is gone (the old contract holds 0.75 $WORD — dust).


- **Share your Wordmark**: earned Wordmarks gain a Share button in the detail popup (same composer flow as the Refer sheet) that pre-populates a cast — "I earned the “Baker’s Dozen” wordmark in @letshaveaword by guessing words starting with 13 different letters across 13 different days! Only 240 other players hold this Wordmark" — with a per-mark brag line, a live only-N-others rarity count (self excluded), and the site as the embed. Unearned marks keep their single "Challenge accepted 🫡" button. The Earned pill now shows round + date, and "Nice ✨" is now "Nice 👌".


- **WordJackpot in Contract Diagnostics**: Operations → Contract Diagnostics gains a third block for the $WORD jackpot contract — unallocated (where the tranche lands), balance, pool, carry, pending claims, active round, oracle-price freshness, operator authorization, and an explicit solvency line (balance vs pool + carry + claimable). Until now nothing in the admin read WordJackpot's live state, so "fund the tranche, then check it arrived" had no check-it-arrived half.


- **Round-34 contracts deployed to Base**: WordJackpot proxy `0x550753Ed…` (impl `0x3439A33A…`), WordPackSales `0xF0B96933…`, GuessLog `0x2dDE6892…` — all Basescan-verified, all seven role checks green. The first run surfaced that the deployer is an EIP-7702 delegated EOA and the RPC allows delegated accounts one in-flight transaction: the deploy script now retries that refusal and can resume past an already-deployed implementation (`EXISTING_WORD_JACKPOT_IMPL`), which is exactly how the real deploy finished.


- **Funding directory in Admin → Treasury**: one card that answers "where do I send $WORD for game use" without hunting — jackpot pool (WordJackpot), bonus/burn words and staking rewards (WordManagerV3) highlighted up top with full addresses, one-tap copy, Basescan links, and one line on what each destination funds; pack sales, guess log, treasury, operator, the ETH-era manager, and the token below. Undeployed contracts show which env var to set instead of an empty hole. Served by a no-RPC `?book=1` fast path on `contract-state`.


- **Round-34 contract deploy script**: `deploy-word-round34-contracts.ts` deploys WordJackpot (UUPS proxy, forceImport-registered), WordPackSales (treasury-immutable), and GuessLog to Base in one run, checks every role reads back as configured (token/operator/treasury/owner ×7), and prints the four Vercel env lines, the Basescan verify commands, and the tranche-funding steps ready to paste. Rehearsed clean on an anvil fork of Base.


- **WordManagerV3: the owner key can no longer touch staker deposits — deployed onchain**: `emergencyWithdraw` — the last unguarded outflow, able to withdraw all 6.46B $WORD of staked principal — now sits behind the same `gameSolvent` reserve check as every game payout, so the owner can only ever withdraw the game-fund surplus. Shipped as contract source + a plugin-driven upgrade script (`upgrade-word-manager-v3-solvency.ts`), rehearsed on an anvil fork of Base, then **executed on mainnet the same day**: implementation `0x36b674bf…` (Basescan-verified), `totalStaked` bit-for-bit unchanged, and the over-surplus probe reverts `WouldTouchStakerFunds` — this also activates the #161/#178 game-payout guards that had never been deployed. The staker-fund invariant is now enforced onchain, not by intent.


- **Incident tooling learns the $WORD era**: a cancelled $WORD round now refunds cleanly — the insight is that players only ever pay ETH (packs and Superguesses, both eras), so refunds stay ETH transfers; what needed building was the rest of the story. ETH Superguess sessions join the per-user refund aggregation (every session in a cancelled round refunds in full, used or not). `flushWordPoolCredits` refuses cancelled rounds, so the treasury never parts with the 80% pool credits for purchases being refunded — the unflushed rows stay as the audit trail. And `emergency-resolve` carries the currency columns (`prizeCurrency`, `prizePoolWord`, a currency-correct prize display) instead of reporting a $WORD round as a zero-ETH one; its actual payout path was already era-aware via the standard resolution pipeline. One $WORD casualty remains contract-side: a cancelled round's onchain seed needs manual recovery from WordJackpot.


- **Reward gate: buying in once is honored (entry floor)**: the $3 play bar is a live check against the round's frozen price, which meant a price crash could lock out a player who had genuinely bought in. Now the first full pass records the token bar the player passed at (`users.reward_gate_bar_tokens`, ratcheting down on cheaper passes), and every later check passes at min(live bar, floor) — hold your entry tokens and no price move can ever gate you out. Selling below the floor forfeits it: the gate stays a holding requirement, never a badge. Rising prices already worked (the token bar shrinks as price climbs); this closes the falling-price half. Migration 0030.


- **Archive chip stacked**: the between-rounds archive chip becomes two stacked, left-aligned lines ("ROUND" over "ARCHIVE ▼"), both in the thin label weight — the same anatomy as the Round chip it stands in for.


- **$WORD sheet polish**: the $WORD nav button drops its purple accent and matches its three siblings; the Fee distribution tile is gone (the API still serves the split for the preview page); and the Market cap tile gains a ↑/↓ 24h change chip. The change had been dead since DexScreener delisted $WORD — it turns out GeckoTerminal does publish a 24h figure, just on the pools endpoint rather than the token endpoint the oracle was reading, so the oracle now asks both (pools best-effort, never at the cost of the market cap).


- **A 6-hour cooldown between rounds (round 34+)**: when a round resolves, the next one no longer tries to start instantly — the ETH era's resolve-time auto-start rarely worked (the treasury usually failed the seed minimum) and left no breathing room when it did. A new cron (`auto-start-round`, every 5 minutes) starts the next round `ROUND_COOLDOWN_HOURS` (default 6) after the last resolution. The eligibility check anchors on the most recently resolved round and requires it to be a $WORD round, which era-gates the whole feature and keeps the Round 34 launch a manual act — auto-start begins only after round 34 itself resolves. A manual admin Start Round bypasses the cooldown at any time. During the window, the between-rounds bar shows "Next round soon… · Starts in about 5h 40m" (via the new public `/api/next-round`) instead of the indefinite pause copy, which stays for dead day and the pre-launch tail.


- **Info-bar and nav-row design fixes**: the bottom nav row (Stats / Refer / $WORD / FAQ) is now evenly spaced at a uniform 8px — between buttons and at the edges alike (the row's own padding sat inside the container's, so edges were 24px against 6px gaps; and the first even-spacing pass at 16px squeezed the $WORD label). The between-rounds banner is rebuilt as a bar with the same height as the live round bar — the info bar's vertical size never changes across loading, error, paused, and live states — and carries an Archive chip in the exact spot the Round #N ▼ chip occupies during a round, same two-line anatomy and caret, linking to /archive. The admin Start Round button moves inline for the same reason, with start errors replacing the subtitle instead of adding a line.


- **Tap a Wordmark to see what it means — held or not**: every cell in the Lexicon grid is now a button. The detail card shows the mark, how it's earned, its rarity ("Only 4 players hold this" — a real number from a live count), and for held marks the story of the earn from the award metadata: "Won Round 4 with 'SCRIM'", "#1 early guesser in Round 1", "Your first guess was in Round 5". Unheld marks show the goal, which is the point — the Lexicon reads as a collection with visible goals (Trailblazer 🚩 exists, go chase it), not a row of icons. Metadata varies by era, so every detail line degrades to nothing rather than to a broken sentence; the color classes move to one shared home so the grid and the card can't drift.


- **Wordmark launch wiring: a dashboard button and the popup line**: The wordmark backfill gets a card in Operations under Player grants (dry run first; Execute unlocks after the counts are shown; the card names its own expiry), so launch day never touches curl. The round-34 announcement's "You're in free" variant now also tells Early Adopters the 💅 mark is on their profile — keyed to a new `earlyAdopter` flag (rounds 1–18) rather than the broader grandfather flag (rounds 1–27), because the ~209 organic players who joined in rounds 19–27 are in free but hold no mark.


- **Two launch Wordmarks: Early Adopter 💅 and Trailblazer 🚩**: Early Adopter is complimentary — granted, not earned — to every account whose first guess landed in rounds 1–18. The cutoff is deliberately not the remembered round-28 wave: production data shows the farm's advance party seeded round 19 (194 fname-less accounts, all registered 2026-03-05, one guess each, then dormant until they reactivated inside the round-33 wave), so the pre-bot era ends at round 18 — 4,029 FIDs, frozen in `users.first_guess_round`. Trailblazer goes to the maker of a round's #1 global guess: recurring per round, a single item per player, awarded at round resolution from `MIN(guesses.id)` — a guess-time check would race with concurrent first guesses, which Bugbot caught — and announced by the bot when a new holder appears. Burn-word guess rows also finally carry `guess_index_in_round`. Rounds 1–33 backfill to 26 first guessers, every one verified organic. Both marks stay hidden from the wordmarks API until a $WORD round exists, so the one-shot backfill endpoint (`round34-wordmarks-backfill`, dry-run by default) can run ahead of launch without leaking the reveal.


- **One vocabulary, one font, honest labels (cleanup Phase D, part 3 — the cleanup's finale)**: The shared `adminFont` becomes the real admin face (Söhne) and thirteen per-file redeclarations die, so shared components stop rendering in a different typeface than the cards around them. Four sets of duplicate formatters (`formatEth` ×2, `formatNumber` ×2, address-shorteners ×3, compact-token ×2) collapse into `components/admin/format.ts`, and the Archive tab's private StatCard yields to the shared one. The era audit turned out better than flagged: the economics and economy endpoints already carry `prize_currency = 'eth'` filters from the round-34 work — what remained was label truthfulness, so "7d Avg Jackpot" now says "(ETH rounds)" and the Economics tab states its ETH-era scope. Still on the launch checklist, not in code: the refund and emergency-resolve paths only know ETH payouts, so a $WORD-round incident needs them extended first.


- **Every tool now lives where its work happens (cleanup Phase D, part 2)**: Operations gains four relocated tools — Round Data Repair and the bonus-distribution retry queue (from Treasury), Archive Maintenance with the three bulk sync/repair actions (from the Archive tab, which is now read-only browsing plus a contextual per-round re-archive), and Force Resolve, which was buried inside the Sepolia simulation card and now stands alone with a proper warning — the wrong place to hunt for a round-ending action during an incident. The player-grant tools (XP, share bonus, guess packs) sit under one labeled cluster. Treasury's static "Add ETH to Prize Pool" instruction card folds into the Balances overview as one caption line.


- **The admin panel restructure begins (cleanup Phase D, part 1)**: One operational-status feed replaces three — the shell now owns the 30-second poll through a shared provider, and the header strip, Operations, and Treasury all read the same object, with `refresh()` after every mutating action; the header and a tab can no longer disagree. Modules move to where their work lives: Farm Monitor and Adversarial Simulations leave Analytics for Operations, Onchain Purchase Events leaves Analytics for the Wallet tab — renamed **Treasury** — and the Round Phase & Incentives module is gone outright (every number in it already renders in the Live Round hero). Analytics is now product analytics only.


- **Endpoint rationalization (cleanup Phase E)**: Seven more endpoints retire — the curl-only analytics twins (`events`, `export`, `metrics`, `referral`, `performance`, `jackpot`; each duplicated a UI-wired sibling, and `export` selected round answers into its output) and `archive-round` (the surviving sync, fix-and-archive, and nightly cron cover every archive path). `fairness` and `word-token` stay deliberately: unique read-only capabilities with no twin. The `contract-state` header stops advertising a POST action that never existed, and the three resolution tools (`force-resolve`, `emergency-resolve`, `recover-stuck-round`) now carry one shared doc block stating which failure mode each serves. Admin endpoint count: 83 → 58, every survivor either UI-wired or a documented shell tool.


- **Seventeen retired admin endpoints and a buried tab (cleanup Phase C, operator-approved)**: All six spent one-column backfills, the OG Hunter era (analytics + backfill + the XP-award option), the CLANKTON snapshot DDL endpoint, the round-2 incident cluster (`fix-round-answer`, `diagnose-round`, `generate-archive-sql` — the general-purpose `fix-round-field`, `debug-round2` and `fix-and-archive-round` stay), `clear-archive-cache`, `xp-debug`, and three of the five overlapping sybil diagnostics (`diagnose-sybil-round`, `wallet-cluster-report`, `cohort-engagement` — Farm Monitor and the cluster-gate dry run carry the mission). The Airdrop tab is buried, not deleted: no tab button, but the full manager still renders at `/admin?tab=airdrop`, and its endpoint and ledger table are untouched; only the long-spent migration bootstrap panel is gone. Git history keeps everything.


- **~1,300 lines of dead admin code removed (cleanup Phase B)**: A second, never-imported analytics dashboard (550 lines on the retired auth pattern), two orphan components, five copies of an unreachable legacy treasury fallback, and two identical unused interfaces are gone. Two half-dead features come back to life instead of leaving: the Analytics auto-refresh toggle was one mis-named prop away from working (the "Live" mode could never turn on) and is now wired; the Archive tab fetched its error list on every load and never rendered it — errors now show as a banner with a resolve action. The broken Export dropdown is removed with its workflow (the endpoint retires in Phase C).

- **Admin hardening, Phase A of the panel cleanup**: The full audit of the admin surface (83 endpoints, 7 tabs) starts paying down. The deprecated, unauthenticated, mutating `refresh-seed-words` endpoint is deleted. `diagnose-guess` and `xp-debug` gain the standard admin check; `award-xp` drops its private admin list for the shared one; `debug-round2` gains a method guard. Two round-34 correctness bugs die: the Social status-cast generator now follows the round's `prize_currency` instead of hardcoding ETH, and the Analytics top-10 cutoff reads `PRICE_RAMP_START_GUESSES` everywhere — the page previously showed both 750 and 850 as fact.

### 2026-08-16 (before Round 34)

- **Recharts 3 (Phase 2 of the admin redesign)**: 2.15 → 3.10 behind the single `AnalyticsChart` wrapper. The wrapper's API surface (line/bar, axes, grid, props-based tooltip, legend) is unchanged in v3; the rewrite's breaking changes sit in customized internals this codebase never touched. This closes the phased admin plan: one shared vocabulary (Phase 0), shadcn on Tailwind 3.4 with Social and Operations converted (Phase 1), and current charts (Phase 2). A Tailwind 3→4 migration remains optional and unlocks Tremor's free block library whenever wanted.

- **shadcn/ui lands in the admin, Social tab first (Phase 1 of the redesign)**: The v3-era shadcn generation (new-york style, CLI 2.3) is initialized against the existing Tailwind 3.4 — the current CLI generation emits Tailwind-v4-only CSS and was backed out. Init edits were scoped to the admin: the game's global body styles, border resets, and design tokens are untouched, and the shadcn theme variables were corrected to the HSL channel form the config's `hsl(var(--x))` mapping expects. Eight primitives are in (`components/ui/`): Button, Card, Alert, Badge, Input, Textarea, Label, Separator. The Social tab is the first converted section — every hand-styled button, input, textarea, and alert becomes a shadcn primitive or the shared AlertBanner, with logic untouched. Operations followed the same day: every status badge becomes the shared StatusPill on one severity scale, all simple alerts become AlertBanner, and 31 label/value rows become the shared InfoRow with tabular numerals.

- **The admin panel gets one shared design vocabulary (Phase 0 of the redesign)**: Eight admin sections each carried a private copy of the same styles, and the drift between them is why the panel reads slowly — this week the header said Normal while dead day was armed. `components/admin/ui.tsx` now holds the one copy: StatusPill (color + icon + word, never color alone), StatCard (one anatomy everywhere, tabular numerals), Module, UpdatedStamp (stale data turns amber), AlertBanner, table styles (numbers right-aligned), AllClear, and a `worstSeverity` rollup so a strip of subsystem states can collapse to one honest verdict. Farm Monitor and the Analytics stat cards are the first consumers; the other sections migrate opportunistically. The header strip now uses the shared StatusPill and an UpdatedStamp that turns amber two minutes after the 30-second status poll silently stops — the exact failure that hid an armed dead day behind a green Normal. Grounded in the 2026-08-16 research report (Carbon, NN/g, GOV.UK, Grafana, WCAG).

- **Tweets now go out through Typefully**: The direct X API access is what died in March. `postTweet` now publishes through Typefully (social set 326839, `publish_at: "now"`) whenever `TYPEFULLY_API_KEY` is set, with the old X client kept only as a fallback transport. All the safety gates stay: production-only, `TWITTER_ENABLED`, and Sentry on every failed publish. Set `TYPEFULLY_API_KEY` in Vercel to turn posting back on — no code change needed at that moment. Five tests cover the transport.

- **The Social tab speaks $WORD, and tweet failures finally speak at all**: The quick tweet templates still promised an ETH jackpot; they now say $WORD, matching every round from 34 on. Separately, the announcer's Twitter cross-post has been failing silently since early March — casts posted, tweets did not, and the only witness was a server console log. The catch now reports to Sentry with the X API error body, so the next attempt names the real cause (expired token, revoked app, or tier limit). After the Typefully switch, the composer's “View tweet” link resolves to the real x.com status URL: the endpoint polls the draft briefly until Typefully finishes publishing, and falls back to the draft URL only when publishing outruns the wait.

- **The kill switch and dead day now actually read their flags**: Both switches were silently no-ops in production. The Upstash SDK auto-parses a stored `'true'` into a boolean on read, and every read in `operational.ts` compared the value to the string `'true'` — a comparison that can never match. The toggle endpoints wrote the flags correctly; nothing could see them. The gap surfaced when dead day was enabled to hold the game before round 34 and the admin panel kept reporting Normal, with no Disable button; until the fix, the only thing preventing an accidental ETH round 34 was the jackpot contract holding 0.0016 ETH against the 0.02 minimum. A shared `isFlagOn` helper now accepts both shapes, and six regression tests drive the real read functions through the exact boolean shape the SDK returns. No migration; the flags already stored in Redis take effect on deploy.

### 2026-08-15 (before Round 34)

- **A Farm Monitor watches round 34 so the guess-path gates can stay off**: The decision (2026-08-15): the reward gate replaces the four heuristic gates, and data decides if they ever turn on. A new admin Analytics module and endpoint (`/api/admin/operational/farm-monitor`) read the farm signature for any round. The cohort basis is `MIN(guesses.round_id)` — the same basis as the grandfather backfill — because it reproduces the recorded waves against production exactly (2,949 / 913 / 59 / 1,591 new guessers for rounds 28 / 29 / 32 / 33), while a `created_at` window sees 15 of round 33's 1,591. The verdict rests on two legs: suspicious-username share among new guessers (the waves measure 91–99%, round 13's organic cohort 19%; the shapes are `.base.eth`, `!`-prefixed, `user-<fid>`, or none — the round-31/32 winners both carry `user-<fid>` names and first guessed in round 28), and $WORD funding fan-out into reward-gate claim wallets (opt-in Blockscout trace). The second leg exists because round 32 is invisible to the first: its 59 accounts carry real-shaped names and Neynar scores of 0.62–0.99, created in batches months ahead and activated together. The ETH era had no funding surface; the gate creates one, because every gated account must claim a funded wallet. When funding is untraced the report says so instead of reading all-clear. Eleven tests; read-only; no migration.

- **The info bar shows the $WORD pool compactly**: The prize pool reads `120M $WORD (≈$20)` instead of `120,000,000 $WORD ($20.00)`. The bar is the tightest surface in the app, and the full-separator form ate its width. The approximation mark is ≈, which the bar already uses for the guess percentage. Compact amounts always carry three significant digits — `999M`, `78.1M`, `1.00B` — and roll up at unit boundaries so `1000M` can never show. Only the info bar compacts; every other surface keeps the full form. Tests cover the formatter and its boundaries.

- **The reward gate gets its player-facing half, sealed until launch**: A one-time announcement modal covers the whole round-34 story on one screen: the jackpot now pays $WORD; hold or stake $3 to play, with a "you're in free" variant for grandfathered players; the USD ladder; and ETH packs growing the pool. The leak guard is server-side and uses the only truthful era signal: `/api/onboarding/status` offers the modal only while the ACTIVE round's `prize_currency` is `'word'`, so a player who opens the app before round 34 starts sees nothing — no date checks, no client flags. The new FAQ entry "Why do I need $WORD to play?" hides behind the same signal. The guess bar gains a locked state: when the gate holds a player out, the bar says so plainly and offers a Buy $WORD button, because the shortfall is $WORD and a guess pack deliberately does not bypass. `/api/user-state` now carries `rewardGate` (enabled / locked / grandfathered) on the same 5-minute cache posture as the tier read. The FAQ's holder-tier entries also stop lying: they described the retired token matrix (100M/200M/300M by market-cap bracket) and now state the USD ladder ($25 / $50 / $75) that has been live since the backend shipped. Migration `0029_round34_announcement_seen.sql` — **apply before deploying**.

- **The reward gate ships dormant: hold or stake $3 of $WORD to play**: Three farm waves are now on record from production data — rounds 28, 29, and 33, with 2,949 / 913 / 1,591 fresh drive-by accounts, overwhelmingly `.base.eth`. Round 33's wave was not previously known. The gate prices the swarm out. Playing requires a wallet that holds the round's USD bar in $WORD, and staked balance counts. Everyone whose first guess predates round 28 is grandfathered in free — about 4,432 FIDs, backfilled into `users.first_guess_round` by a new admin endpoint. One wallet can vouch for only one FID per game-day, through a unique `(date, wallet)` claim table; nothing else in the schema constrains wallet to FID, so without it one funded wallet could clear the bar for a thousand accounts. The check rides the existing daily-allocation balance read with the same 5-minute cache; every money point re-checks uncached at award time, because bonus and burn transfers are instant and a wallet that dumped its tokens after allocation must still fail at the moment a reward is earned. Covered money points: the winner (through `checkWinnerEligibility`, which gains a fourth parallel check), bonus words, burn words, the admin retry endpoint for failed distributions, the Top 10 at resolve (ineligible accounts do not rank; the next eligible moves up), and the referrer share (an ineligible referrer redirects the 5% as if absent). A withheld bonus or burn find marks the word claimed, moves no money, and returns the exact shape of a plain wrong guess — the same indistinguishability invariant the ineligible-winner path keeps. An ETH pack purchase does not bypass the bar (decided); purchases still credit, and the credits stay locked until the bar clears, because the payment verifies after it lands onchain and refusing then would take money for nothing. The holder ladder is USD-denominated now: $25 / $50 / $75 for +1 / +2 / +3 daily guesses, converted from the oracle market cap, replacing the token-fixed matrix at values within a dollar of the old rungs. If the chain cannot be read, the gate fails open and Sentry hears about it. Everything sits behind `REWARD_GATE_ENABLED`, off by default, for the round-34 launch. Sixteen tests. Migration `0028_reward_gate.sql` — **apply before deploying**, then run the backfill endpoint once.

- **Superguess now says ETH everywhere, and the user confirmed the currency**: PR #196 moved the Superguess payment to ETH on 2026-08-14 inside a security fix, and the decision was never put to the user as a question — it is now confirmed: Superguess stays ETH. Four surfaces still described the $WORD era. The guess-pack modal's Superguess row showed "$WORD" as the price label. The purchase modal's rules line still described the deleted 50% burn / 50% staking split; it now states what is true: paid in ETH, and 80% of the payment grows the prize pool. Worst, the insufficient-balance button said "Buy $WORD" and opened the $WORD token page — the shortfall is ETH, so the button steered players to an asset that cannot pay for a Superguess; it is now "Get ETH" and opens the host's swap UI for native ETH on Base. FAQ.md matches the in-app FAQ again. The payment hook also lost its dead $WORD-era code: an unused token address, an unused operator wallet, and an unused ERC-20 ABI. The USD tier prices ($20–$90) did not change; only the settlement asset moved.

- **Next.js 14 → 16.3.1, React 18 → 19.2, Turbopack builds**: Next.js 14 reached end of life on 2025-10-26. The May and July 2026 security releases shipped fixes with no 14.x patch. Several of those fixes close middleware-bypass paths, and this app's middleware guards the admin routes, so the upgrade is the only mitigation. The upgrade surface was small, because the app never adopted next/image, next/font, AMP, runtime config, or router events. The changes:
  - `middleware.ts` is now `proxy.ts`, because Next 16 deprecates the old name. The logic is unchanged. The code now runs on the Node.js runtime instead of the Edge runtime.
  - `next.config.js` is now a typed `next.config.ts`. The removed `eslint` config key is gone.
  - Turbopack now bundles both `next dev` and `next build`. A production compile takes about 1.4 seconds.
  - Sentry uses the Turbopack-era layout: the client init moved to `instrumentation-client.ts`, and a new `instrumentation.ts` registers the server init. The new `onRequestError` hook reports every server-side error to Sentry with route context, with no local try/catch needed. `@sentry/nextjs` moved to 10.70.0. Note one behaviour change: the old layout never loaded the server init, so server-side Sentry was silently dead — it is live now, and server events will start to appear. Both inits stay gated on the DSN, as before. The edge init file is deleted, because nothing runs on the Edge runtime any more.
  - recharts moved to 2.15 with a `react-is` override. It was the one dependency without React 19 support.
  - The unused `@pigment-css/react` dependency is removed. The project is on hold upstream, and no file imports it.
  - React 19 changed one line of app code: a `JSX.Element` annotation in Wheel.tsx.
  - React 19 now skips hydration mismatches from tags that third-party scripts inject. Farcaster webviews inject such tags, so expect fewer false hydration errors in Sentry.
  - `next dev` now maintains an agent-rules block in CLAUDE.md that points AI tools at the bundled Next 16 docs. The block is committed, because `next dev` re-creates it on every run.

  Verification: 505/505 tests pass, the build is clean with zero warnings, a dev-server smoke test serves `/`, `/archive`, and `/verify`, and the TypeScript error count is unchanged against the pre-upgrade baseline.

- **External links now work outside the mini app**: Each "View on BaseScan" button, each "tx ↗" link, and each profile tap on the archive and verify pages called `sdk.actions.openUrl()` or `viewProfile()` directly. These calls are RPCs to the Farcaster host. Outside a host, nothing answers: the promise never settles, does not reject, and the click does nothing. This is true on plain web and also in non-host webviews such as in-app browsers. The pages themselves work in a browser, because they fetch public APIs, so the dead controls were reachable. All 13 `openUrl` call sites now go through one `ExternalLink` component. The component renders a real `<a target="_blank">`, so a web visitor gets a real link, with cmd-click and right-click copy. The component routes a click through the SDK only after a Farcaster host confirms the handshake, because environment hints such as `ReactNativeWebView` also match non-host webviews. A new `useIsInMiniApp` hook decides this once for all call sites. The hook caches only a confirmed yes, and it probes twice before a no becomes final, because a slow host handshake can lose the SDK's 1-second race. Handlers that call `window.open` use the settled probe value synchronously, because a popup blocker stops a window that opens after an awaited delay. Profile taps on web open the player's `farcaster.xyz` page. Token views on web open the GeckoTerminal pool page; the old fallback sat in a `catch` that an unsettled promise can never reach. The "Verify round" button on the archive page no longer opens the app's own `/verify` page through the SDK with a hardcoded origin on web. On web the button navigates in the app. In the host the button keeps the browser overlay, so the player keeps their place in the archive.

- **Sepolia was never using the configured RPC endpoint**: the code read `BASE_SEPOLIA_RPC_URL`; the deployment had `SEPOLIA_RPC_URL` set. Neither side was wrong on its own terms, so nothing errored — every Sepolia call just quietly fell back to the public `sepolia.base.org` instead of the Alchemy endpoint that was configured and paid for. That is the kind of misconfiguration that survives indefinitely, because working slowly against someone else's rate limit produces no symptom to notice. It matters right now: the next step in the relaunch is a **Sepolia dry run of the WordManagerV3 upgrade**, against a proxy holding 6.46B in staker deposits, and a rate-limited public endpoint is the wrong thing to rehearse that on. Both `src/lib/word-token.ts` and `contracts/hardhat.config.ts` now accept either name. An audit of every variable set in the deployment against every variable the code reads found no other functional mismatch — the remainder are Neon/Vercel-injected aliases and the Neynar client ID that went dead with the SIWN removal. Two tests, verified against the single-name version.

- **Three costs removed from the guess path**: all three ran per guess or per poll, so each was paid repeatedly by every connected player rather than once. **`getBaseProvider` had no timeout and built a new provider every call.** ethers defaults to **300 seconds** — verified, not assumed: reverting the fix makes the test report `expected 300000 to be less than or equal to 15000`. That is not a timeout in any useful sense on a request path, since the serverless function is long dead by then and so is every caller waiting on it; an unresponsive RPC endpoint held connections open until the platform killed them. Now 8 seconds, and one provider per URL instead of a fresh one per call, which also restores connection reuse and stops re-running network detection on every guess. **`getGlobalGuessCount` selected one column for every guess and returned `result.length`** — a late round shipped ~4,400 rows across the network to produce a single integer, on the endpoint the top ticker polls. Now `COUNT(*)`. **The $WORD holder tier was an onchain balance read in front of every guess**, because `getOrCreateDailyState` re-checks it. Cached for five minutes, which is long by the standards of everything around it and deliberately so: the tier only ever moves *up* within a day, so a stale value can delay someone's upgrade by minutes but can never take away guesses already granted. A zero produced by a failed RPC call is **not** cached — a failure is not evidence the player holds nothing, and caching it would deny them bonus guesses for five minutes because of an outage on our side. That needed more than a `try/catch`: `getEffectiveBalance` and `getWordBonusTier` both swallow their own errors and return 0, so an outage **never throws** and the catch would never have seen it. Distinguishing the two cases required a variant that reports whether the answer was actually determined, and the distinction cuts both ways — a genuine zero *is* cached, or non-holders (the common case) would keep paying an RPC call per guess. Six tests, each verified by reverting the fix it covers.

### 2026-08-14 (before Round 34)

- **The copy that outlives a round now says what is true**: the **Farcaster manifest** advertised the app in four places as *"Global word game. ETH prizes"*, *"win ETH"*, *"Find the word, win the ETH"* — that is the app-store listing, seen before anyone plays. `_document.tsx` put *"hits the ETH jackpot"* on every embed of the site, while `splash.tsx` beside it already said just "the jackpot". Three surfaces still told players Superguess costs **$WORD** when the code has charged **ETH** since this morning, and two of them described a 50% burn / 50% staking split that no longer exists at all — copy describing a mechanism that had been deleted. `CLAUDE.md` still opened by calling this a game "with ETH jackpots" where "winners receive proportional ETH payouts", which is the first thing anyone working on the code reads and was actively steering them toward the ETH path; it now states the per-round rule, names the currency-abstraction modules it omitted entirely, and warns about the hand-written-field-list trap that produced four separate bugs in one day. `FAQ.md` had drifted into contradicting the shipped in-app FAQ and has been reconciled. **The `$WORD` cashtag convention needed no sweep** — the audit found zero instances of bare `WORD` in any outbound copy, because the unit is attached upstream in two formatters rather than typed by hand at each site. What it did need was one fix: `twitter.ts` truncated at 280 with a blind `slice(0, 277)`, so a cut landing inside `$WORD` produced `$WO...` and silently killed the cashtag on X — and the milestone casts carry the token mid-string and sit close to the limit. Truncation now backs off to a word boundary. Three tests, verified against the old slice.

- **A player's earnings read in the currency they actually won**: the stats panel stacked a $WORD line *underneath* a tile labelled "All-time **ETH** won", so the label contradicted half the number below it — and the ETH figure rendered `0.0000` unconditionally, which for the ~99% of players with no pre-34 winnings looked like a reported loss rather than an absence. Both lines now name their own currency and each appears only when non-zero, with $WORD leading because it is what the game pays in now; a player with neither sees `0` rather than a zero in a currency they never played for. Labels drop the word ETH, since the component renders both. The referral figure was worse: a bare four-decimal number under a label reading only "Earned", with no unit anywhere — correct-by-convention until round 34, and a guess for the player afterwards. The share cast also announced `0.0000 ETH earned` to Farcaster for anyone who had never played a pre-34 round; both currency lines are now conditional.

- **Reporting stops mixing the two eras**: seven aggregates summed or averaged across rounds 1-33 and 34+ as though they were one population, and the fix differs by table in a way worth stating. The **archive** columns are NULL for the currency that does not apply, so `SUM` skips them and each era's total is already clean — what was missing there was the $WORD half, so `getArchiveStats` now returns `totalJackpotDistributedWord` alongside the ETH figure. The **rounds** columns are not: `prize_pool_eth` is `NOT NULL DEFAULT '0'`, so a $WORD round does not self-exclude from an average — it enters as a *zero-value round* and drags every mean down without changing any sum. Filtering on `prize_currency` fixes `metrics.avg_jackpot`, `economy`'s 7-day average, daily trend and sustainability score (which divided ETH revenue by an average deflated with $WORD zeros — a ratio of two things measured over different populations), `economics`' pool metrics (whose "pool velocity below target" health alert would have fired on rounds that never had an ETH pool), and the fairness monitor's jackpot baseline. The public archive's two chips also implied a matched pair they were not: *"ETH distributed"* was jackpots and *"$WORD distributed"* was bonus-word rewards, with $WORD jackpots shown nowhere — now three chips that each say what they measure. The **admin live-round tile** read `0.0000 ETH` for the whole of a $WORD round; it and the big prize-pool panel now take both value and unit from the round. The **rounds CSV export** gained the currency columns the payouts export was given in the same edit that missed this one — the worst place to drop a discriminator, since a spreadsheet cannot recover it. And the three legacy standalone admin pages (`/admin/archive`, `/admin/analytics`, `/admin/operations`), superseded by the tabbed dashboard but left routable with no redirect, now redirect: the archive one called `parseFloat` on a NULL `finalJackpotEth` and rendered the literal string **"NaN ETH"**, and the operations one asked you to confirm *"the onchain payout of 0 ETH"* on a $WORD round.

- **Guess packs and Superguesses now grow the $WORD prize pool**: PR A deliberately made `applyPaidGuessEconomicEffects` a no-op on a $WORD round because the answer wasn't settled — it is now. 80% of every purchase is credited to the pool in $WORD at the price in force when it was bought, and the remaining 20% is creator revenue: the same split the ETH economy ran inside `JackpotManagerV3`. What is new is that the pool side needs an explicit conversion, because the money arrives in ETH and the prize is paid in $WORD. **This changes what the tranche is** — it was scoped as a subsidy draining over ~105 rounds, and it isn't: every token it pays into a pool arrives backed by ETH the treasury just received, so it is working capital cycling rather than a burn. The exposure that replaces it is smaller and different: between crediting and the treasury's later buyback, the treasury is short $WORD, so a price rise in that window means the same ETH repurchases fewer tokens than were paid out. Credits accumulate in a new `word_pool_credits` ledger and reach WordJackpot in **one batched top-up before the round resolves**, so nobody waits on a transaction to buy a pack. That choice creates exactly one new failure — an unflushed credit — and `resolveRoundAndCreatePayouts` now **refuses to start** while any credit is outstanding, naming the missing amount. Without that check the same problem surfaces as a reverted payout transaction with a winner already found and the round already announced; same outage, far worse moment. Two properties are load-bearing and tested directly: the credit path **never rejects a purchase** (the player has already paid by then, so a stale oracle is the house's problem — it degrades and records the gap, and falls back to the round's own seed price before giving up), and it credits **exactly once per payment** via a unique `(source, tx_hash:log_index)`, because a retried webhook is indistinguishable from a real purchase at every other layer. Each row records the rate it was struck at, so the treasury's buyback can be audited against what was actually paid out. `resolveRoundAndCreatePayouts` flushes automatically and then verifies, so the refusal is the backstop for a *failed* send rather than the normal path — without the automatic flush nothing called it at all, and any round that sold a pack would have refused to resolve forever. The flush marks exactly the rows it summed, by id: `topUpWordPoolOnChain` waits for a confirmation, and re-selecting "everything unflushed" afterwards would mark a purchase that landed during that wait as sent when it was never in the total — reintroducing the short-pool revert one layer below the guard meant to prevent it. Eleven tests, including one that lands a purchase mid-flush via the mock. Migration `0027_word_pool_credits.sql` — **apply before deploying**.

- **A $WORD round now archives as a $WORD round**: the archive row is the one record nothing ever recomputes, and **three separate hand-written column lists** were each dropping the currency discriminator — none of them a `select()`, so nothing type-checked or warned. The first is the one that matters: `archiveRound`'s raw SQL never selected `prize_currency`, so the `archiveIsWord` flag it computes was **always false**, and every currency branch downstream of it — the payout amount mapping, the top-guesser pool accumulator — read as ETH regardless of what the round paid. That code was written, reviewed and shipped, and had never once run. The second: the INSERT wrote only `seed_eth`/`final_jackpot_eth` and left `currency` to its `'eth'` column default. The third: `getArchivedRounds`' select omitted the columns again, so even a correctly written row reached `/api/archive/list` with no currency on it. Any one left intact renders round 34 as ETH — and the read side (`archiveCurrency`, `formatArchiveJackpot`) would have done it faithfully, because it was told `'eth'`. The ETH columns are now **NULL** on a $WORD round rather than `'0'`: `'0'` asserts "this round paid zero ETH", which is a real measurement and is what `getArchiveStats` sums into the public "ETH distributed" figure, whereas NULL says the question does not apply and `SUM` skips it. Writing honest NULLs is also what made the three archive serializers' unguarded `.toString()` calls reachable — nullable since migration 0022 — so those are null-guarded here rather than left to 500 the whole page on one row. `ROUND_RESOLVED` analytics events now carry `prizeCurrency` and `prizePoolWord`, because `view_jackpot_growth` charts `data->>'prizePoolEth'` and filters on `IS NOT NULL`: a $WORD round emits `'0'`, which passes the filter, so the admin growth chart plotted round 34+ at zero rather than omitting it — fixing the view alone could not help while the event carried no way to tell the cases apart. The two admin repair paths (`fix-and-archive-round`, `generate-archive-sql`) now **refuse** a $WORD round instead of writing an ETH row; the second is worse than it sounds, since it emits SQL designed to be pasted into a production console, so a mislabelled round would arrive pre-approved. Three round-trip tests that archive a round, read it back through the list query and format it the way the UI does — verified by reverting each of the three column lists separately and confirming each is independently caught.

- **A $WORD round can no longer be written into the ETH economy's columns**: `applyPaidGuessEconomicEffects` models JackpotManagerV3 — ETH in, 80% to the contract jackpot, 20% split between the DB-tracked seed and creator balance — and had **no currency branch at all**, while `resolveRoundAndCreatePayouts` beside it did, which is what made the omission easy to miss. None of that model describes a $WORD round: the pack is still bought with ETH, but it goes to WordPackSales and on to the treasury, while the prize sits in WordJackpot as tokens. It needed nobody to do anything wrong to fire — all three call sites in `guesses.ts` branch only on `isPaidGuess`, so the **first pack purchase of round 34** would read the old ETH contract's balance and write it into `prize_pool_eth`. The failure mode is nastier than a plain wrong number: the column starts at `'0'`, which reads as an obvious bug, and then quietly heals into a plausible non-zero ETH figure that was never that round's prize — which `archive.ts` copies into the permanent archive and the admin economics aggregates sum into their ETH totals. `syncPrizePoolFromContract` had the same hole, reachable both at round creation and from the `sync-prize-pool` admin endpoint; the guard sits inside the function rather than at either call site, so a third caller cannot reappear without it. `seed-jackpot` gets a guard too, because its existing "cannot seed while a round is active" check asks *JackpotManagerV3* whether a round is active — and during a $WORD round, by its reckoning, none is. Growing a $WORD pool as packs sell is deliberately **not** implemented here: it needs decisions this function cannot make (which tranche funds it, at what oracle price), and the onchain half already exists as `topUpWordPoolOnChain()`. Also fixes what made the endpoint guards decorative: `getActiveRound` does `select()` — every column is fetched — then rebuilds a `Round` from a hand-written field list that dropped the $WORD columns, so `prizeCurrency` came back `undefined` for all ~50 callers. `Round` declares it optional, so nothing type-checked the omission, and the type's own comment reads a missing value as "an ETH round" — silent, and defaulting the wrong way for round 34+. Both getters now carry it. Five tests, four of which fail with the relevant fix removed — the $WORD round's pool moves 0.1 → 0.1008, which is exactly the corruption — plus one asserting rounds 1-33 still get the full ETH treatment, so the guard is narrow rather than a blanket off-switch.

- **The test suite now refuses to run against a non-test database**: it is destructive by design — `retireActiveRounds()` resolves whatever round it finds before *every* test, and several files create and resolve rounds freely — yet it read whatever `DATABASE_URL` was in the environment with no idea which database that was. Pointed at production it created **90 rounds**, and because starting a round calls `announceRoundStarted()`, the announcer posted **87 casts from the live bot account** and attempted a broadcast push notification per round. Nothing in the suite objected, because nothing was watching. The root cause is worth stating precisely: `announcer.ts`, `twitter.ts` and `notifications.ts` *each already had* a "never post outside production" hard stop keyed on `NODE_ENV`, and every one of them was correct. `.env.local` sets `NODE_ENV=production` alongside `ANNOUNCER_ENABLED=true`, `TWITTER_ENABLED=true` and `NOTIFICATIONS_ENABLED=true` — so sourcing one file to obtain a connection string disarmed all three at once. Guards that share a single input are one guard. `setup-guards.ts` now refuses any database that is not on localhost or named `*test*` (CI's is `lhaw_test`, so CI is unaffected), and restores those flags. It lives in its own file, listed first in `setupFiles` and importing nothing from `src/`, because the first attempt put the same code at the top of `setup.ts` and **it did nothing**: ES imports are evaluated before the module body, so `economics.ts` → `announcer.ts` had already snapshotted `ANNOUNCER_ENABLED` into a module-level const before the assignment ran. A third layer clears `NEYNAR_SIGNER_UUID` and `NEYNAR_APP_UUID` so neither channel can authenticate even if a flag is wrong — added because verifying the flag guards by removing them **posted a real cast**, through a `vi.mock('../lib/farcaster')` that looked like protection and was not, for exactly the same ordering reason. A cast can be deleted; a broadcast notification cannot. Those two are assigned `''` rather than `delete`d, because `delete` leaves the key *missing* and missing is exactly what `dotenv.config()` refills — it never overwrites a key that is present, but it will supply one that is not, and `farcaster.ts` calls it at import time. Six tests, and the full suite runs with `.env.local` sourced posting nothing.

- **A guess lost to a server error is no longer silently swallowed on retry**: `/api/guess` claims a Redis key per (fid, word) for 30 seconds before processing, so that the retry a player makes after the frontend's 12s timeout cannot spend a second credit on a guess already recorded. That part is wanted; the bug was that the claim was never released. Written before processing and only ever expiring, it could not tell "already recorded" from "attempted and failed" — so when submission threw, no row was written and no credit spent, yet every retry for the next 30 seconds returned `duplicate_ignored`, which `index.tsx` renders as **no banner at all**. The player pressed GUESS and watched nothing happen. `clearDuplicateGuess` had existed since Milestone 9.6 for exactly this and was never called. The key now carries the outcome: held when the guess was durable, released when nothing was recorded — including `no_guesses_left_today`, where buying a pack and retyping the same word takes well under 30 seconds. Classification is an exhaustive switch, so adding a status to `SubmitGuessResult` is a compile error until someone decides which side it falls on; `bonus_word` and `burn_word` count as recorded because a retry there is a double-payout attempt, not a wasted credit. The claim is also now a single `SET NX` rather than GET-then-SET, which let two concurrent identical submissions both read an empty key and both proceed. Seven tests; verified by reverting each half separately — the handler wiring, then the atomic claim — and confirming the right ones fail. The concurrency test initially passed against the racy version because the Redis fake was effectively atomic; it now yields between operations so the interleaving is actually reachable.

- **Removed the SIWN sign-in component and neutralised the cookie it set**: `AdminAuthWrapper.tsx` is deleted now that Sign In With Farcaster is confirmed working — it was dead code carrying hardcoded admin FIDs. Its `siwn_fid` cookie is a subtler problem: **58 admin endpoints still read it as an identity fallback**, unsigned and client-settable, and the only thing that ever legitimately set it was retired on 2026-08-14. Rather than edit 58 handlers — they use two different shapes, and a blanket edit risks changing control flow in files nobody will re-read — middleware now strips the cookie from every `/api/admin/*` request before it reaches a handler, so the path is dead whatever the handler does with it. Defence in depth rather than the primary control: the admin guard already rejects unauthenticated callers, and this is what stops the cookie mattering again if `ADMIN_SECRET` is ever lost or unset. Three tests, two of which fail with the strip removed — verified rather than assumed, after checking the assertions were not passing vacuously against a header that does not exist.

- **Closed an answer-disclosure side channel between two public endpoints**: an *ineligible winner* — a correct guess from an account that failed the sybil check — is stored with `is_correct = true` and `is_ineligible_winner = true`, and must be observably indistinguishable from an ordinary wrong guess, or comparing surfaces reveals the word. `guesses.ts` documents that invariant and three call sites honoured it. `/api/wheel/wrong-guesses` did not: it filtered on `is_correct = false` alone, so those words were **omitted** there while `/api/wheel` marked them `wrong`. Diffing two unauthenticated responses named the secret word — the word present in one and absent from the other. Latent only because ineligible-winner rows require a sybil gate to be enabled, and all four are off; enabling the cluster gate would have activated it. Fixed by calling the shared `getWrongWordsForRound` rather than repeating its `WHERE` clause a fourth time, since a fourth copy is how the third one drifted. Four tests, two of which fail against the old filter — including one that performs the diff attack directly rather than testing a proxy for it.
- **Superguess is bought with ETH, and a replay that granted free sessions is closed**: payment verification scanned the receipt for *any* $WORD transfer to the operator wallet of at least 80% of the tier price. It never checked who sent it and never recorded which payment bought which session, so an attacker could read a historical transfer off Base — public data — and submit its hash for a free 25-guess session at the round's decisive moment. Worse, the endpoint then spent **real operator funds** in response: burning $WORD and moving more to staking against a payment that had never been made. Now the payment is the game's own `SuperguessPurchased` event from `WordPackSales`, with the payer taken from `msg.sender` and the `(tx_hash, log_index)` pair recorded uniquely, so one payment grants exactly one session even inside a bundled ERC-4337 transaction. **Currency moves to ETH**: players earn $WORD by playing — jackpot, bonus words, top ten — and spend ETH to buy, matching guess packs. A first-time player is far likelier to hold ETH than the reward token, and pricing purchases in $WORD pushed holders to sell the very thing staking exists to encourage them to keep. Tiers stay USD-denominated ($20–$90) and convert at purchase, with the same below-quote floor packs use so an ETH move between signing and confirming cannot take a player's money and give nothing back. The client is also handed an exact amount instead of parsing `"64M"` back into a number to decide what to pay. **Note the economic consequence**: the per-purchase 50% burn / 50% staking split is gone with the currency it operated on — ETH accumulates in `WordPackSales` and withdraws to the treasury, so recreating the deflationary effect is now a deliberate batched treasury operation rather than something that happens inline. Migration `0026_superguess_eth.sql` — **apply before deploying**.
- **Admin sign-in moved from SIWN to Sign In With Farcaster**: Neynar retired SIWN on **2026-08-14** — existing connections keep working, but no new ones are issued, so the old flow was about to strand anyone signing in on a fresh browser. Neynar's own migration note points at managed signers, which is the wrong target here: managed signers are *authorisation* (act on behalf of an account) while this dashboard only needs *authentication* (which FID is this), a distinction their docs draw themselves before sending authentication to SIWF. All four admin pages now use `@farcaster/auth-kit`, with the signature verified server-side and exchanged for the signed HttpOnly session added alongside. The browser now holds no credential it could forge — the UI decides what to render, the server decides what is allowed, which is the split the old `?devFid=6500` flow inverted. Also passes an explicit Optimism RPC to the verifier: with none configured `@farcaster/auth-client` falls back to the public endpoint and logs “Do not use this in production”, and a rate-limited RPC makes sign-in fail intermittently — which reads as a wrong key rather than an outage.

- **Admin sign-in moves toward Sign In With Farcaster** (server half; SIWN is deprecated): the SIWF endpoints already existed — `/api/auth/nonce` and `/api/auth/verify`, using `@farcaster/auth-client` — and nothing ever called them. They also could not have worked: `nonce.ts` kept nonces in a module-level `Map`, so on Vercel a nonce issued by one serverless instance was unknown to the instance receiving the signed message. That passes locally, where there is one process, and fails intermittently in production in proportion to how many instances are warm — a plausible reason the migration stalled half-built. Nonces now live in Redis and are consumed with `GETDEL`, which makes redemption atomic across instances rather than merely persistent; it fails **closed** if Redis is down, unlike the rate limiter beside it, because failing open on a rate limit costs some spam while failing open here would accept unverified sign-ins to an admin surface. Verification now also **mints something**: a signed, HttpOnly session cookie, issued only for admin FIDs. A verified signature authenticates one request; without a credential the client cannot forge, the next request is back to taking the caller's word for their FID, which is exactly the `?devFid=` hole. Signed with HMAC-SHA256 via Web Crypto so one implementation both signs in the API route and verifies at the edge. `ADMIN_SECRET` remains as break-glass for curl and for recovering when sign-in itself is broken. 18 tests, including tampered payloads, unsigned tokens and expiry.

- **The admin API is no longer protected by a number that ships in the browser bundle**: ~80 admin endpoints authenticated on a caller-supplied FID — accepted from a query parameter, a body field, or an unsigned `siwn_fid` cookie — and the admin FIDs are hardcoded in `AdminAuthWrapper.tsx`, which is served to every visitor. `?devFid=6500` was published information rather than a guess. Three endpoints (`refresh-seed-words`, `operational/diagnose-guess`, and the dev-gated `xp-debug`) had no check at all. What that reached: `operational/recover-stuck-round` returns a round's **decrypted answer** for any round id, `operational/withdraw-word-token` sends the contract's entire $WORD balance to a caller-supplied address, and `operational/airdrop` pays ETH from the operator wallet with no amount cap. A gate in `middleware.ts` now requires `ADMIN_SECRET` on every `/api/admin/*` request. It sits at the perimeter rather than in each handler for two reasons: one place cannot be forgotten when an endpoint is added, and it covers the three that never had a check — which a per-endpoint migration would have missed by definition. **Dormant until `ADMIN_SECRET` is set**, so deploying it changes nothing on its own. The secret is accepted from a header or a cookie, so the dashboard's ~76 existing fetch calls keep working untouched; the admin page probes the API and prompts for the key once, storing it in a session cookie. 9 tests, three of which fail with the gate removed.

- **A cohort comparison to settle what the cluster gate is actually catching**: after the behavioural bypasses, the dry run still said ~192 of 500 low-score clustered accounts would be blocked, and that only ~5% of them had ever shared or bought anything. That number is uninterpretable alone — 5% is damning if the rest of the player base sits at 60%, and meaningless if the rest sits at 5% too. `/api/admin/operational/cohort-engagement` reports share rate, purchase rate, guesses and rounds played for four cohorts side by side (all players, clustered, low-score, and the intersection the gate acts on), so the question stops being a matter of interpretation. Cluster size there is a fixed hour-bucket count rather than the gate's sliding ±1h window — stated in the response, because it makes cohort proportions reliable and per-user verdicts not. Also fixes the dry run returning a different sample each run: its candidate query had no `ORDER BY`, so a before/after comparison was reading a changed population as a changed outcome.

- **Paying or sharing now exempts a player from the sybil gate**: the first production dry run said the gate as configured would block **238 of 500** low-score candidates, while the Coinbase attestation bypass cleared **6**. The reason is base rates — `MIN_COHORT=5` was calibrated when the farm looked like “22 wallets in a 3-hour window”, and the live data has organic and farmed clusters of 200, 600, 900+ in a ±1h window, with 13,697 users sitting inside clusters of ≥5. Cluster size stopped being a discriminating signal as the player base grew, and a bypass that reaches 2.5% of the blocked does not rescue it. Two behavioural signals do much better. **No bot has ever bought a guess pack** across 33 rounds, and that is structural rather than lucky: the farm's whole model is many free accounts, so it never needs paid guesses. Publishing that as a bypass does invite buying one pack per account to unlock it — but the cost scales with account count, which is precisely the axis the farm's advantage depends on, and a farm that pays is funding the pool it is trying to win. **Sharing to earn a guess** is ranked below it, because a cast can be automated where money cannot, but it should clear far more real players since sharing is ordinary play and buying is not; the bonus is only granted after a real public cast is verified, so faking it at scale means thousands of visible casts — the loud activity that got the last swarm noticed. Both default on, both disableable, and the dry run reports each exemption separately so their actual yield is measurable rather than assumed.

- **A pack purchase is keyed on the event, not the transaction**: this was the blocker that made gas sponsorship unshippable. An ERC-4337 bundler batches user operations from different accounts into **one** transaction, so two players buying at the same moment come back with the same transaction hash and one `PacksPurchased` event each. `pack_purchases.tx_hash` was `UNIQUE`, so the first submission was credited and the second rejected as a duplicate — after that player had already paid. `verifyPackPurchaseTransaction` compounded it by taking the *first* event in the receipt, meaning the amount and payer being checked could belong to somebody else's purchase. Verification now collects every event, narrows by the caller's own wallet and by which log indexes are already credited, and refuses outright rather than guessing when several unclaimed events remain and nothing distinguishes them. The unique key becomes `(tx_hash, log_index)`, with a partial unique index preserving the old one-credit-per-transaction rule for rows written before this existed — Postgres treats NULLs as distinct, so without it an old transaction could be claimed a second time with a real index attached. Five tests, two of which fail against the old schema. Migration `0025_pack_purchase_log_index.sql` — **apply before deploying**.

- **The cluster gate can be dry-run before it blocks anyone**: `WALLET_CLUSTER_GATING_ENABLED` is on, and nothing answered the question that matters — who does it actually block? `wallet-cluster-report` was the closest thing and does not answer it: it shows *clusters*, while the gate blocks on a compound condition (cluster size **and** low score **and** no Coinbase attestation), so a large cluster of high-score players is not a block and a cluster of verified users is not either. Inferring the gate's behaviour from cluster sizes overestimates the damage in one direction and misses every exemption in the other. `/api/admin/operational/cluster-gate-dry-run` calls `checkWalletCluster` itself rather than reimplementing its rules — a dry run that can disagree with the real gate is worse than none, because it gets believed — and reports both who would be blocked and who was saved only by their attestation. That second number is what says whether the bypass is doing anything for this player base or whether the gate is still as blunt as before; it comes from a structured flag rather than a matched reason string, so it cannot quietly stop counting. Read-only with respect to gating, pre-filtered to users who could plausibly be blocked, and evaluated sequentially because each miss can cost a Blockscout page and an RPC round trip. The old report's note was also corrected — it still described the `.base.eth` scope that stopped being the default when the farm began winning with placeholder handles.

- **Pack purchases can be gas-sponsored** (built, **not yet safe to enable**): Farcaster players arrive on ERC-4337 smart accounts and currently need Base ETH for gas *on top of* the pack price — two assets to hold for one purchase, on the flow the game's revenue depends on. Where the wallet advertises `paymasterService` (EIP-5792), the same call now routes through `wallet_sendCalls` with a paymaster attached. Strictly additive: a wallet without the capability, the flag off, or a paymaster that refuses all fall back to the user paying their own gas. The paymaster URL is proxied through `/api/paymaster` rather than shipped to the client — the upstream URL carries an API key, and **a paymaster with no policy sponsors anything**. That proxy allowlists exactly one thing, `buyPacks` on the pack sales contract, unwrapping both `execute` and `executeBatch`, requiring *every* call in a batch to pass, and refusing any account encoding it does not recognise. 11 tests on that policy. **Blocker before switching on**: ERC-4337 bundlers batch several user operations into one transaction, so two players buying in the same bundle get the same transaction hash — `pack_purchases.tx_hash` is UNIQUE, so the second is rejected as a duplicate after paying, and `verifyPackPurchaseTransaction` takes the *first* `PacksPurchased` event in the receipt, which may be someone else's. Unreachable while the flag is off, since the non-sponsored path sends one transaction per purchase. The fix is to key a purchase on the event rather than the transaction — unique on `(tx_hash, log_index)` — which changes a replay-protection invariant and gets its own change.
- **The guess log is now committed to Base**: the answer has always been committed onchain and revealed at `/verify`, but the guesses were not — and the guesses are what decide the money, since the first correct one wins and positions 1–850 set the top-10 payouts. Those lived only in Postgres, so a server that dropped, delayed or reordered a guess would have changed who got paid with nothing to show it. A new **GuessLog** contract now takes an append-only Merkle root over each contiguous block of guesses every five minutes. Contiguity is enforced onchain rather than assumed: a checkpoint must start exactly where the last one ended, so a range cannot be skipped and a committed range cannot be re-posted over. There is no amend and no delete. The leaf commits to `guessIndexInRound` — the same number the top-10 lock already uses — so the ordering being proved is the ordering that decides payouts rather than a parallel one that could drift from it. `/api/verify/guess-proof` returns the leaf pre-image, checkpoint, root, posting transaction and Merkle proof, all checkable against Base without trusting the API. Honest about its limits: this proves nothing already committed can be rewritten, not that a guess was submitted at all — catching omission needs a signed receipt at guess time, and this is the half that makes such a receipt worth holding. Holds no funds and is not upgradeable, deliberately: a log whose rules can change afterwards is one you have to trust rather than check. 17 contract tests including second-preimage resistance, plus a cross-language assertion that Solidity's `hashLeaf` matches the encoding the backend hashes — a drift there would not throw, it would just stop verifying. Migration `0024_guess_log_checkpoints.sql` — **apply before deploying**.

- **A Coinbase Verified Account now exempts a player from the sybil gate**: the wallet-cluster heuristic has shipped disabled since it was written, because co-mint clustering is circumstantial — “your wallet was created around the same time as some other players’ wallets” is also true of anyone onboarded in a launch wave, and the cost of a false positive is blocking a real player. A Coinbase onchain attestation (EAS on Base) is evidence about *this person* that a farm cannot mass-produce, so verified players are now exempt and the cohort threshold can be tightened at the farm without taking honest players with it. The bypass is a bypass only: it never blocks anyone who lacks an attestation, so unverified players face exactly the gate they face today. Coinbase’s indexer is used to find the attestation UID but trusted for nothing — schema, attester, recipient, revocation and expiry are all re-read from the EAS contract and re-checked, so a bad indexer answer can at worst point at an attestation that is then rejected. An RPC failure denies the bypass rather than granting it. Migration `0023_coinbase_attestation_cache.sql` — **apply before deploying**.

### 2026-08-13 (after Round 33)

- **Game economy converted from ETH to $WORD**: No round had run since Round 33 ended on 2 July — `createRound` could not clear JackpotManagerV3's 0.02 ETH `MINIMUM_SEED` against a 0.00162 ETH carry, so `/api/game` had been returning 500 for six weeks. Rounds are now seeded with ~$20 of $WORD from a treasury tranche instead, which removes the ETH floor entirely. Two new contracts: **WordJackpot** (UUPS, holds the $WORD prize pool, computes the seed from its own oracle price so the USD peg is a property rather than a comment, and defers a failed payout to `claimable()` instead of reverting the whole batch) and **WordPackSales** (immutable, takes ETH for packs and records the payer as `msg.sender`). Guess packs are still bought with ETH — only the prize changed. The whole path stays dormant behind `isWordEconomyConfigured()` until `WORD_JACKPOT_ADDRESS` and `WORD_PACK_SALES_ADDRESS` are set, so nothing changes until the contracts are deployed and funded. Migration `0022_word_economy.sql` — **apply before deploying**.
- **Rewards oracle-priced in USD**: Bonus words pay **$1.50** and top-10 first place **$3.00** of $WORD, replacing fixed token amounts with a crude market-cap step. Each has a token cap so a bad oracle reading cannot drain the tranche. Deliberate asymmetry: round seeding *refuses* to proceed on a stale price (a mispriced seed is large and irreversible), while a reward *degrades* to the legacy fixed amount (a player who found the word has earned it). Found and fixed en route: `guesses.ts` had its own hardcoded 5M constant and never called the config function, so the admin dashboard projected a per-round cost the game did not pay — a 2× divergence above $150K mcap.
- **Game payouts can no longer spend staked $WORD**: `WordManagerV3`'s three distribution paths transferred until the ERC-20 ran out, so once the tranche emptied the next reward came out of a staker's deposit and they found out when `withdraw()` reverted. Measured exposure was ~218M free tokens against ~97.6M/round of outflow — roughly two rounds. Added `reservedForStakers()` / `availableForGames()` and a solvency guard; the batch path checks the **total**, since per-transfer checks each see a balance the previous transfer already reduced. Adds no storage, verified by diffing the compiled layout against the live implementation. First tests this contract has ever had (17). Not yet deployed — needs a Sepolia dry run.
- **Every player-facing surface reads currency from the round, not a global flag**: ticker, archive, winner share card, OG image, share text, push notifications, @letshaveaword casts, FAQ, stats and referral panels. The archive shows rounds 1–33 in ETH beside 34+ in $WORD on one screen, which is why a global toggle would not work. Fixed three bugs of the same shape in the process — a formatted string read as a number: the archive's rank split did `parseFloat("7,812,500")` → 7; the OG image did `parseFloat("78,125,000 $WORD")` → 78, advertising a 78 ETH prize; and the resolve cast's top-10 sort compared `NaN`, listing the ten in arbitrary order. None threw.
- **`amount_eth` is NULL on a $WORD payout** (0022 drops its NOT NULL) and 14 sites read it as a number. The fairness monitor derived expectations from `prizePoolEth`, hit its zero-jackpot guard, and would have silently stopped auditing payouts from Round 34; `archiveRound` wrote `"NaN"` into a permanent record; admin analytics under-reported creator revenue, winner payouts, seed totals and referral earnings; and `diagnose-sybil-round` ordered by `amount_eth desc`, which sorts NULLs last and scrambled $WORD payout ranking in the tool used to inspect suspected sybils. Every aggregate now has a parallel `_word` column — ETH and $WORD are never summed into one figure.
- **Jackpot milestone casts fixed for $WORD**: thresholds were ETH values `[0.1, 0.25, 0.5, 1.0]`, and a $20 seed is ~78,000,000 $WORD — all four would have fired the moment a round started, four casts before anyone guessed. $WORD rounds now use USD milestones ($50/$100/$250/$500).
- **Oracle hardened**: added the Uniswap v4 pool as a second, independent price source and cross-check it against GeckoTerminal (15% tolerance), with timeouts on every fetch — previously a hung upstream would hang the 15-minute cron indefinitely.
- **Pack pricing docs and tests corrected**: `pack-pricing.test.ts` had been asserting the pre-Milestone-7.1 schedule (0.0003 / 0.00045 / 0.0006) against code pricing at 0.0004 / 0.0006 / 0.0008 — **all 28 of the suite's failing tests were this one stale file**. Suite now reports 237 passed, 0 failed. `getPackPriceWithMultiplier`'s examples had drifted on every line and one contradicted itself (claimed 2× while showing 1.5×). `DEFAULT_RULES_CONFIG` was seeding fresh environments with the pre-2026 80/10/10 split.
- **CI runs contract tests** (`.github/workflows/contracts.yml`) — there was no `.github/` at all, so no contract test had ever run in CI. Suite went 65 → 82 passing.
- **Six more bugs found by reading the TypeScript errors** — the `sql` ReferenceError below had been sitting in a pile of 166 compiler errors, so the pile got read. Wrong property names, every one silent at runtime. **The announcer recorded no cast hashes**: `publishCast` resolves to `{ success, cast }` and the code read `.hash` off the response instead of off `.cast`, so `announcer_events.cast_hash` was written as NULL on every row, the `postedAt` stamp was only written when the Twitter cross-post happened to succeed, and the referral-win cast — which is meant to reply to the round-resolved cast — posted unthreaded. **Bonus word progress always read zero**: `round_bonus_words` names the column `claimedByFid` while `round_burn_words` names the same idea `finderFid`, and `/api/bonus-burn-status` used the burn name on the bonus table, so every round reported no bonus words found and all of them remaining. **OG Hunter undercounted adds**: `AddMiniAppResult` has no `added` field — the SDK reports refusal by throwing — so the guard collapsed to "did they also enable notifications", and anyone who added the mini app without granting them was never recorded, on the campaign whose purpose is counting adds. **The admin revenue badge was permanently red** and DAU rendered blank, both reading flat `packPurchasesToday` / `dauToday` off a response that nests them under `today` and `avg7d`. **`/api/word-balance` fetched a live market cap and then ignored it**, reading `marketCap` where the type has `marketCapUsd`, so the staking threshold was quoted off the stale env constant while the price two lines above used the live figure. **`pre-resolution-check` never worked**: four invented column names meant it printed “❌ MISSING” for the commitment and the encrypted answer on every run and returned failure unconditionally, and its payout preview still described the pre-2026 80/17.5/2.5 split — on the screen you consult immediately before resolving a round. It now computes the preview with `computePrizeSplit`, the same function resolution uses. tsc 159 → 135.
- **Four real bugs surfaced by finishing the test suite** — 402 of 402 now pass and CI runs all of it with no exclusions. (1) A round won while its prize pool was empty was never closed: the zero-jackpot branch returned before the update that records the winner and marks the round resolved, so `resolvedAt` and `winnerFid` stayed null and status stayed `active` — `getActiveRound` kept returning a finished round, the already-resolved guard never fired, and no new round could start. Reachable in ordinary play, when the seed carries nothing and the winner spends a free guess before anyone buys a pack. (2) `archiveRound`'s guard against archiving an unresolved round was dead, because `new Date(null)` is 1970-01-01 rather than an invalid date, and 1970 is perfectly truthy — a live round could be archived mid-play with 1970 written into the permanent record as its end time. (3) `economics.ts` used `sql` without importing it, so the salt-corruption recovery path threw a `ReferenceError` instead of recovering; tsc had been reporting it all along, buried in 166 pre-existing errors (now 159). (4) Resolution never wrote back the seed that actually carried forward on ETH rounds — the column kept the paid-guess accumulator while the contract carried 5% of the final pool, and `archiveRound` derives a round's seed from the previous round's copy of that column. Also removed `resolveRound`'s `referrerFid` parameter, which was accepted, documented, and passed nowhere; the referrer share is 5% of a prize pool and its recipient must come from the winner's user record, not from an argument.
- **Tests that were passing for the wrong reason**: the wheel suite asked whether an array of objects `toContain('HOUSE')` — false for every word, guessed or not — so `not.toContain('BRAIN')` read as "the answer is not leaked" while being unable to fail either way, even if the wheel had marked the answer as the winner before anyone guessed it. The case-insensitivity test spelled out `'CrAnE'` and kept doing so after the fixture answer changed to `brain`, so it checked that a wrong word is wrong. A top-guesser test guessed `word1`…`word5`, none of which are real words, so all five were rejected and the function was asked to limit an empty set. The `$WORD` tier tests stubbed a config value nothing on that path has consulted since Milestone 14 and created no user, so the tier stayed 0 and the upgrade under test could not happen. Two more asserted `populateRoundSeedWords` fills a table it has not written to since Milestone 4.11, and one asserted a three-pack daily cap that was deliberately removed. Also killed a flaky pair that derived their expectation from a live CoinGecko call.
- **CI runs the app test suite too** (`.github/workflows/app-tests.yml`, Postgres service + `drizzle-kit push`), and a third of the suite that could never run now does. Importing `src/db` threw at module scope when `DATABASE_URL` was unset, so nine files failed at collection — including `rate-limit.test.ts`, which makes no database calls and only reached it through an import chain. Deferring the connection to first use took discovered tests from 237 to 404. Six integration suites were separately unrunnable because `createRound` requires a deployed contract and refuses to run while a round is active: tests now go through a `createTestRound` helper (the `skipOnChainCommitment` option existed for exactly this and no test had ever used it) and retire their rounds in `afterEach`. `setSkipOnchainResolution` likewise had never been set by anything, and was unreachable even if you set it — the contract read happened before the skip check, so resolution threw first. 370 of 404 now pass, up from 308; the remaining 34 are individual assertion failures, some of which look like real bugs (a winner FID not persisting, a resolved round still returned as active) and are tracked in the workflow comment rather than hidden.

### 2026-08-12 (after Round 33)

- **GeckoTerminal added as market cap oracle source**: DexScreener delisted $WORD (~Aug 11), leaving the oracle with no working source — the browser landing page showed “$WORD · $0” and onchain market cap updates went stale. The oracle now falls back DexScreener → GeckoTerminal → CoinGecko, and the landing page hides the market cap when no live value is available.
- **Token links repointed to GeckoTerminal**: every “view/buy $WORD” link still went to dexscreener.com, which no longer resolves for this token. The splash-page contract link, the `BuyButton` fallback (rendered in the $WORD sheet and holdings panel), and the Superguess “Buy $WORD” fallback now share a single `WORD_POOL_URL` constant in `config/economy.ts` instead of three hardcoded URLs. The `NEXT_PUBLIC_DEXSCREENER_POOL_ADDRESS` env var is renamed `NEXT_PUBLIC_WORD_POOL_ADDRESS` (it was unset, so no deployment change is required) and the pool address now has a hardcoded default. FAQ copy updated to match.

### 2026-06-28 (post-Round 32)

- **Blockscout per-page timeout raised 5s → 10s** (`src/lib/wallet-cluster.ts`): high-activity wallets return a large first transactions page (~50 items / ~200KB) that can take ~6s to serve. The old 5s budget aborted page 1 before any data was read, so the lookup returned `verified=false` and the wallet stayed *permanently* unverified (every retry hit the same slow page). This misclassified legitimate high-activity wallets as “no Base history” (fail-open) and stalled the `wallet_first_tx_at` backfill on them — surfaced when the post-#145 backfill hung on 2 such wallets. 10s clears the observed ~6.3s worst case with margin. Latency stays bounded: the gate caches the result and only re-fetches after the 6h cooldown, and page-2+ timeouts already degrade to a verified partial result, so only the rare uncached slow first page is affected.

### 2026-06-13 (post-Round 32)

- **Wallet-cluster gate no longer `.base.eth`-scoped**: Round 32 (and, on review, Round 31) was won by a placeholder-username account carrying the confirmed R28/R29 farm fingerprint — Coinbase Smart Wallet (EIP-7702), `user_score` 0.600, first-seen on the R28 incident day, 0/0 Farcaster followers. The wallet-cluster gate exempted it at the first line (`src/lib/wallet-cluster.ts`): it only evaluated `*.base.eth` usernames, so the farm simply stopped setting basenames. Fix: the gate now evaluates **all** users by wallet co-mint clustering (`user_score < SCORE_MAX` + `wallet_cluster_size >= MIN_COHORT`); username suffix is no longer a gating key. Pure Farcaster/Warpcast users with no Base activity are still unaffected (no resolvable first-tx → fail open). New `WALLET_CLUSTER_REQUIRE_BASE_ETH` env flag (default `false`) restores the legacy narrow scope as a one-env-var rollback if a legitimately batch-onboarded cohort ever trips it. **No schema migration** — `0021`'s columns and `users_wallet_first_tx_at_idx` already cover the broadened query. Operational step: run `POST /api/admin/operational/backfill-wallet-first-tx` (admin) until `remaining: 0` so the now-in-scope accounts have `wallet_first_tx_at` populated, otherwise cluster sizes undercount them.

### 2026-05-18 (during Round 31)

- **Admin re-announce endpoint**: Round 31's start cast and push notification never went out — the Neynar account was suspended for non-payment, so both the cast (`publishCast`) and the notification (Frame Notifications API), which share `NEYNAR_API_KEY`, failed silently (every announcer/notification failure path only `console.error`s). Added `POST /api/admin/operational/reannounce-round` to re-fire the round-started cast and/or notification for a given round (defaults to the latest active round). Works around the announcer's idempotency record — a `round_started` row is written to `announcer_events` *before* the cast attempt, so a plain re-run of `announceRoundStarted()` would skip the cast. The endpoint updates that record with the new cast hash and refuses to re-post an already-posted cast unless `force=true`. Does **not** cross-post to Twitter/X (the original tweet is unaffected by Neynar outages). Extracted `buildRoundStartedAnnouncement()` in `announcer.ts` so the cast/notification copy stays in one place.

### 2026-04-29 (post-Round 29 follow-up)

- **Wallet-cluster gate (third sybil-defense layer)**: Investigated the wallet-history gate's effectiveness against the actual Round 28/29 attack surface. Two findings flipped the design: (1) all bot wallets are Coinbase Smart Wallets — for which `eth_getTransactionCount` doesn't reflect activity (ERC-4337 hides it through the EntryPoint), so the prior gate's threshold was tuned against the wrong signal; (2) bot wallets *do* show a clean fingerprint at deployment time — 22 wallets co-minted within a 3-hour window on 2026-03-15, vs. real users' wallet first-tx dates spread across months (cluster size of 2 is the legit max in a 168-user sample). New compound gate blocks ONLY when `.base.eth` + `user_score < 0.70` + `wallet_cluster_size >= 5` (within ±1h via Blockscout); pure Farcaster/Warpcast users are unaffected. Behind `WALLET_CLUSTER_GATING_ENABLED`. New `WALLET_IN_BOT_CLUSTER` error code; new `wallet_first_tx_at`, `wallet_first_tx_checked_at`, `wallet_cluster_size` columns. Operator-facing audit endpoint at `/api/admin/operational/wallet-cluster-report` lists detected clusters for review (passive, no auto-action). Sanity-check sample also surfaced a previously-undetected 9-wallet cluster from 2025-09-14 — earlier sybil wave or batch onboarding, worth investigating retroactively. Migration: `0021_wallet_cluster_gate.sql` — apply BEFORE deploy.

### 2026-04-28 (post-Round 29)

- **Wallet-history gate + winner-eligibility check**: Round 29 was botted again. Diagnostic showed all 27 bonus/burn finders across Rounds 28–29 were `.base.eth` accounts at score 0.60 with wallets clustered at **8–12 outgoing Base txs and ~$0.01 ETH** — the cost-floor footprint of a Coinbase Smart Wallet that was deployed, registered a basename, added a Farcaster signer, and was never used for anything else. Legit comparison wallet sat at 3,447 txs (300× separation).
  - **New gate at guess submission**: blocks accounts whose connected wallet has fewer than `WALLET_HISTORY_MIN_TXS` (default 20) outgoing txs on Base. Cached on `users.wallet_tx_count`; counts are monotonic so a passing wallet stays passing. Behind `WALLET_HISTORY_GATING_ENABLED`. New `WALLET_TOO_FRESH` error code. RPC failures fail open with Sentry alert.
  - **Winner-eligibility re-check at win-time**: defense-in-depth. Even if guess-time gates fail open or are misconfigured, when someone guesses the secret word we re-run wallet-history + account-age with `forceRefresh: true` before locking the round. An ineligible correct guess is recorded with `is_ineligible_winner=true` for audit, no payout fires, and the API returns the same shape as a wrong guess. To close side channels (bot using a second account to compare `already_guessed_word` vs `incorrect`, or comparing wheel state), ineligible-winner rows are treated identically to wrong guesses in `hasBeenGuessedIncorrectly`, `getWrongWordsForRound`, and the wheel display. **Tradeoff:** once an ineligible-winner row exists for a word, the global dedup blocks all subsequent attempts at it — the round becomes unwinnable. Operators see a Sentry alert and can use the kill-switch to cancel + refund + restart. Automatic cancellation is the right follow-up but requires daily-guess-credit refund tooling that the current refund flow doesn't cover.
  - **FAQ updated** with the four-layer bot-prevention model (quality score, FID age, wallet history, winner re-check).
  - Migration: `0020_wallet_history_gate_and_winner_eligibility.sql` — apply BEFORE the deploy lands or full-row reads of `users`/`guesses` will break (lesson from Round 29's "column does not exist" outage).

### 2026-04-22

- **Admin: activate streaming rewards from the UI**: Added controls inside the "WordManager funding" card to start/extend a 30-day Synthetix-style reward period without leaving the admin dashboard. Two modes: *Activate with existing balance* (calls `notifyRewardAmount()` against tokens already in the contract) and *Send & Activate* (signs a $WORD transfer from the connected wallet, then activates on confirmation). Typed "STREAM" confirmation, progress states, BaseScan links on success. Backed by the existing `POST /api/admin/operational/fund-staking-pool` endpoint; audit-logged via `/api/admin/wallet/actions` with `actionType: 'streaming_activation'`.

### 2026-04-21 (post-Round 28)

- **Account-age gating for guessing**: Added a Farcaster FID-age gate that blocks guessing from accounts less than 14 days old. Source of truth is the Farcaster Hub `onChainEvents` Register event (immutable, cached on `users.fid_registered_at`). Quality-score gate rubber-stamped the Round 28 sybil farm — age is the orthogonal signal. Gated behind `ACCOUNT_AGE_GATING_ENABLED`; `ACCOUNT_AGE_MIN_DAYS` (default 14) and `ACCOUNT_AGE_ALLOWLIST` tunables. Hub failures fail open with Sentry alert. New `ACCOUNT_TOO_NEW` error code.

### 2026-04-13

- **Real ERC20 burn for $WORD tokens**: WordManagerV3 now calls `ERC20Burnable.burn()` instead of transferring to `0xdead`. Burns from `claimBurnWord()` and `burnWord()` (including Superguess 50% burn) now reduce `totalSupply()`, so DexScreener and other aggregators reflect the true circulating supply. Deployed to Base as implementation `0x1156cA05…` (proxy `0x2eEa96E8…`).

### 2026-04-02

- **Slang words added**: YEETS, DEGEN, YOINK, NOOBS, CHADS, PWNED, NERFS. Removed offensive terms: PYGMY, ARYAN, NEGRO, SAMBO, SQUAW, HONKY, SKANK, GIPSY, MAMMY. 4,437 words.

### 2026-03-24

- **CLAWD added to word list**: Added CLAWD as a valid guess word, bringing the total to 4,439 words.

### 2026-03-24 (Milestone 15: Superguess)

- **Superguess mechanic**: After guess #850, any player can purchase a Superguess with $WORD tokens for an exclusive 25-guess, 10-minute window. All other players are paused and watch live as spectators. 50% of payment is burned via the WordManager contract, 50% is sent to the staking rewards address. One Superguess per round.
- **Spectator live view**: Spectators see the Superguesser's guesses replayed in their letter boxes within 3 seconds. Wheel polling speeds up to 3s during active sessions. TopTicker turns red. Guess button shows "WATCHING @USER GUESS LIVE". Bonus/burn/win modals shown to spectators.
- **Superguess in purchase modal**: The guess pack purchase modal now shows 1-pack, 3-pack, and Superguess options. Superguess option grayed out before 850 guesses.
- **$WORD wallet balance check**: Superguess purchase modal checks the user's $WORD balance and shows a "Buy $WORD" button (opens Farcaster swap UI) when insufficient.
- **Onchain tx verification**: Purchase endpoint verifies the ERC-20 Transfer event on Base, validates minimum payment against live $WORD price (80% tolerance), and rejects if oracle is unavailable.
- **SHOWSTOPPER Wordmark**: Awarded on Superguess purchase. Added to Wordmarks list in FAQ and Stats.
- **Announcer integration**: Farcaster casts for Superguess activated, won, and failed (includes bonus/burn words found during the attempt). Push notification on purchase.
- **Pack pricing update**: 1-pack base price increased to 0.0004 ETH, 3-pack to 0.0012 ETH (same stage-based scaling). 2-pack option removed.
- **Dev safety**: `getActiveRound()` filters `is_dev_test_round=false` in production. `ensureDevRound()` only resolves dev test rounds. Prevents dev mode from affecting live rounds.
- **Admin tooling**: Trigger, cancel, and status endpoints for Superguess sessions. Debug state available via `/api/admin/operational/superguess-status`.

### 2026-03-05 (after Round 14)

- **Pashov audit safeguard: pre-flight ETH receive check**: Before round resolution, each payout recipient is now tested with a 1-wei `eth_call` simulation to verify they can accept ETH. If a contract recipient has a reverting `receive()` function, the payout is redirected to the operator wallet to prevent bricking resolution. Substitutions are logged for manual follow-up.
- **Staking depletion monitoring**: Admin dashboard Wallet tab now shows staking health status. When the WordManager token balance is within 3 rounds of game distributions above total staked principal, a red alert warns that staker withdrawals may fail.
- **Admin dashboard cleanup**: Removed obsolete "Upgrade Contract to V3" card (V3 already deployed), "Reset for Launch" dead code (post-launch), and Sepolia diagnostics card from Operations tab. Deleted `upgrade-contract.ts` and `reset-for-launch.ts` API endpoints. Removed Sepolia state query from contract-state API. Sepolia Simulation card retained for testing.
- **ERC-8021 builder code on all backend transactions**: Added Base builder code attribution suffix (`bc_lul4sldw`) to all operator-signed onchain transactions across `jackpot-contract.ts`, `word-manager.ts`, `word-oracle.ts`, `refunds.ts`, and `airdrop.ts`. Previously only user-initiated client-side transactions (pack purchases, staking) included the builder code. Also added builder code to ERC-20 approve calls in `useStaking.ts`.

### 2026-03-02 (after Round 14)

- **Fix jackpot top-up on round start**: Treasury seeding via `seedFromTreasury` (V3 contract feature) now gracefully falls back to operator wallet top-up if the deployed contract hasn't been upgraded to V3 yet, instead of failing the entire round start.

### 2026-02-18 (during Round 14)

- **Automated Notification Templates**: Replaced single hardcoded push notification messages with 8 randomized templates each for round-start and daily-reset notifications. Templates interpolate live round data (round number, jackpot ETH). Added Vercel Cron job (`/api/cron/daily-notify`) running at 11:00 UTC for daily free guess reset notifications.
- **Burn Word Announcement Automation**: Added cast + tweet announcements when a burn word is found, mirroring the existing bonus word announcement. Posts finder username, the word, and remaining burn words count.
- **Archive Page Bug Fixes**: Fixed two crashes on `/archive` and `/archive/[roundNumber]` caused by field name mismatches between frontend interfaces and backend API responses (`totalWordTokenDistributed` → `totalWordTokenBonuses`, `wordTokenBonusCount` → `clanktonBonusCount`).
- **$WORD Whale Badge**: Renamed "$WORD Holder" wordmark to "$WORD Whale". Fixed staked balance inclusion so stakers keep their badge. Fixed `WORD_MANAGER_ADDRESS` trailing newline that broke all WordManager RPC calls.
- **Burn Word Finders in Round Modal**: Fixed crash in burn-word-finders API caused by referencing non-existent `users.pfpUrl` column in Drizzle query. Burn word finders now display correctly in the round modal.
- **Game Activity Stats**: Fixed bonus word count showing 0 (was querying `wordRewards` table which was never populated for bonus words). Now queries `roundBonusWords` directly. Filtered to $WORD-era only (excludes legacy CLANKTON claims).
- **XP Streak Fix**: Replaced raw `sql` template with Drizzle `lt()` operator in `checkAndAwardStreakXp()` — the Date object caused `ERR_INVALID_ARG_TYPE` on every streak check.
- **User State Race Condition**: Added `onConflictDoNothing()` to user insert to handle concurrent requests for the same new user.
- **Announcer Username Fix**: Fixed bonus/burn word casts showing `fid:249958` instead of username by using `getUsernameByFid()` with Neynar API fallback.
- **Game Activity Auto-Refresh**: Added 30-second polling for tokenomics data in $WORD sheet.
- **FAQ Improvements**: Reordered all 27 FAQ questions into logical grouped sections (Core Gameplay → Guesses & Pricing → Winning & Rewards → Special Words → $WORD Token → Progression & Achievements → Trust & Verification → Access). Removed contract name references (WordManager/JackpotManager) from all answers. Show full $WORD token address instead of truncated.
- **Wordmark Stack Updates**: Reordered badge display (Baker's Dozen now behind Quickdraw). Changed $WORD Whale badge icon to app logo.

### 2026-02-17 (after Round 13)

- **Lower Seed Cap to 0.02 ETH**: Reduced the jackpot seed requirement from 0.03 ETH to 0.02 ETH across the smart contract (JackpotManagerV2 UUPS upgrade), backend economics, admin UI, and all documentation. Includes Hardhat upgrade script for deploying the new implementation.
- **WordManagerV3 — Synthetix Streaming Staking**: Upgraded staking contract from bare vault to Synthetix `StakingRewards` pattern. Global accumulator (`rewardPerTokenStored`) distributes rewards proportionally to all stakers in O(1) gas. 30-day reward periods started by operator via `notifyRewardAmount()`. UUPS upgradeable proxy. Same-token safety check accounts for staked balance + accrued unclaimed rewards. All V2 game functions preserved (commitRound, bonus/burn claims, top-10 distribution). Frontend StakingModal now shows real streaming reward counter capped at period end, estimated APR, and period countdown. Admin contract diagnostics card shows reward period status and rate.
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

Integrated $WORD token rewards and penalties into round gameplay, with onchain commitment and verification via the WordManager contract on Base (upgraded to V3 with Synthetix-style streaming staking rewards):

- **Bonus Words** (`src/lib/guesses.ts`, `src/lib/word-lists.ts`)
  - Each round includes 10 hidden bonus words drawn from the full dictionary
  - Finding one awards 5M $WORD tokens directly to the player's wallet
  - Detected automatically during guess submission — no special action required
  - Committed onchain before round starts via `keccak256(abi.encodePacked(word, salt))`

- **Burn Words** (`src/lib/burn-words.ts`)
  - Each round includes 5 hidden burn words that destroy $WORD tokens permanently
  - Finding one permanently burns 5M $WORD via ERC20Burnable.burn() (reduces totalSupply)
  - Finder receives +100 XP and the "Arsonist" wordmark — bragging rights, no token reward
  - Same keccak256 commitment system as bonus words

- **Wordmarks** (`src/lib/wordmarks.ts`, `components/WordmarkStack.tsx`)
  - Permanent collectible badges awarded for in-game achievements
  - 9 wordmarks: OG Hunter, Side Quest, Arsonist, Jackpot Winner, Double W, Patron, Quickdraw, Encyclopedic, Baker's Dozen
  - Displayed on profile and archive pages

- **WordManager Contract** (`src/lib/word-manager.ts`)
  - UUPS upgradeable proxy on Base (V3 with Synthetix streaming rewards)
  - Owner/Operator pattern: deployer wallet for admin, server wallet for game operations
  - `commitRound()` — commits 16 keccak256 hashes (1 secret + 10 bonus + 5 burn) before round starts
  - `claimBonusReward()` / `claimBurnWord()` — verified claims that check hash before execution
  - `distributeTop10Rewards()` — batch top-10 $WORD distribution in one transaction

- **$WORD Staking** (WordManager V3)
  - Synthetix-style streaming rewards — `rewardRate` $WORD/second distributed to all stakers proportionally
  - 30-day reward periods started by operator via `notifyRewardAmount()`
  - Staked tokens count toward effective balance for holder tier calculations
  - Functions: `stake()`, `withdraw()`, `getReward()`, `exit()`

- **Top-10 $WORD Rewards** (`src/lib/economics.ts`)
  - Top 10 guessers receive $WORD rewards in addition to ETH payouts
  - Reward amounts scale dynamically with $WORD market cap tiers
  - Same ranking percentages as ETH (19% for #1, 16% for #2, etc.)

- **Dual-Contract Verification** (`pages/verify.tsx`)
  - `/verify` page shows commitments from both JackpotManager (SHA-256) and WordManager (keccak256)
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
  - `WORD_MANAGER_ADDRESS` — WordManager (V3 proxy) contract address on Base

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
  - Market cap fetched from DexScreener, then GeckoTerminal, then CoinGecko

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
  - With referrer: 5% referrer, 5% seed (capped at 0.02 ETH, overflow to creator)
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
  - `SHARE_CAST` (+15 XP) — Sharing guess to Farcaster/Base
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
  - Tracks seed cap compliance (0.02 ETH max)
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
    - 2.5% to Seed (bringing total to 7.5%, still capped at 0.02 ETH)
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
