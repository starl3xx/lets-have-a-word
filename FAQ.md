# Let's Have A Word! – FAQ

## How does the game work?

Every **Let's Have A Word!** player worldwide is hunting the same secret 5-letter word. Every incorrect guess helps everyone else by removing that word from play.

The **prize pool** is the total ETH collected during a round as players purchase guess packs. When someone guesses correctly, the round ends and the **jackpot** — the winner's share of the prize pool — is paid out automatically onchain. A new round then starts with a new secret word.

## Can I see the word after someone wins?

**Yes.** When a round is won, the secret word is revealed publicly by @letshaveaword.

You can view all past winning words, round details, and payouts in the Round Archive:
https://letshaveaword.fun/archive

You can also independently verify each round's cryptographic commitments and reveals at:
https://letshaveaword.fun/verify

## What does "provably fair" mean?

Before each round begins, Let's Have A Word **commits onchain** to all **16 words** — the secret word, 10 bonus words, and 5 burn words — using cryptographic hashes.

The secret word is committed as a SHA-256 hash (with a hidden salt) to the JackpotManager contract. The 15 bonus and burn words are committed as keccak256 hashes to the WordManager contract. These commitments guarantee that **no words can be changed mid-round** — not by the game, not by the creator, not by anyone. Importantly, **the creator does not know the secret word while the round is live**. Words are only revealed after they're found or the round ends.

When a round ends:
- The secret word and salt are revealed by @letshaveaword
- Bonus and burn word hashes are verified against the committed values
- Anyone can recompute the hashes
- Anyone can verify all 16 words were fixed from the very start

You don't have to trust this; you can verify every round yourself at:
https://letshaveaword.fun/verify

This commit–reveal process makes every round transparent, verifiable, and fair.

---

## What are bonus words?

Each round has **10 hidden bonus words**, randomly selected from the full word list. When you guess one, you automatically receive **5M $WORD tokens** (or **2.5M** when market cap is above $150K). You don't need to do anything special — just guess a 5-letter word as usual, and if it matches a bonus word, the reward is sent to your connected wallet. You also earn **+250 XP** and the **Side Quest** wordmark.

Bonus words are committed onchain as keccak256 hashes before the round starts, so no one (including the game's creator) can change them mid-round. When you find one, the contract verifies your word against the committed hash before releasing tokens.

## What are burn words?

Each round has **5 hidden burn words**, randomly selected from the full word list. When you guess one, **5M $WORD tokens are permanently destroyed** — burned from the supply forever. You don't receive any $WORD for finding a burn word, but you do earn **+100 XP** and the **Arsonist** wordmark.

Like bonus words, burn words are committed onchain as keccak256 hashes before the round starts. The contract verifies the word against its committed hash before executing the burn.

## What is a Superguess?

Superguess is a high-stakes late-game mechanic. After the round reaches **850 guesses**, any player can purchase a Superguess with $WORD tokens for an **exclusive 25-guess, 10-minute window**.

During a Superguess, all other players are paused and watch live as spectators. If the Superguesser finds the secret word, they win the jackpot. If they use all 25 guesses or time runs out, normal play resumes immediately.

50% of the $WORD payment is burned, and 50% goes to staking rewards. Purchasing a Superguess earns the **Showstopper** Wordmark. One Superguess per round.

## What are wordmarks?

Wordmarks are **collectible badges** displayed on your profile. You earn them by hitting specific milestones or achievements during gameplay. Once earned, they're yours permanently.

Here's the full list:

- **OG Hunter** — Participated in the OG Hunter prelaunch campaign
- **Side Quest** — Found a bonus word during a round
- **Arsonist** — Found a burn word during a round
- **Jackpot Winner** — Won a round jackpot
- **Double Dub** — Found two or more special words (bonus, burn, or secret) in the same round
- **Patron** — Someone you referred won a jackpot (you received the referrer payout)
- **Quickdraw** — Placed in the Top 10 Early Guessers
- **Encyclopedic** — Guessed words starting with every letter A–Z
- **Baker's Dozen** — Guessed words starting with 13 different letters, on 13 different days (only the first guess of each day counts)
- **Showstopper** — Purchased a Superguess

---

## What are free guesses?

Every player gets **1 free guess per day**. Free guesses don't cost anything (obvs) but can still win the jackpot. Free guesses **are** counted in the Top 10 Early Guessers ranking.

Free guesses reset daily at **11:00 UTC**.

## How do I get more guesses?

You can earn bonus free guesses by:
1. Sharing your daily guess on Farcaster (+1 guess/day)
2. Holding [$WORD](https://farcaster.xyz/~/token/eip155:8453/erc20:0x304e649e69979298BD1AEE63e175ADf07885fb4b) tokens (+1 to +3 guesses/day depending on balance and market cap tier)

You can also purchase paid guess packs (3 guesses per pack, unlimited purchases with volume-based pricing).

## What's the $WORD bonus?

Holding [$WORD](https://farcaster.xyz/~/token/eip155:8453/erc20:0x304e649e69979298BD1AEE63e175ADf07885fb4b) tokens gives you bonus free guesses every day. The number of bonus guesses depends on your balance and the current market cap:

**When market cap is below $150K:**
- 100M tokens → **+1 guess/day** (Tier 1)
- 200M tokens → **+2 guesses/day** (Tier 2)
- 300M tokens → **+3 guesses/day** (Tier 3)

**When market cap is $150K–$300K:**
- 50M → +1, 100M → +2, 150M → +3

**When market cap is above $300K:**
- 25M → +1, 50M → +2, 75M → +3

Staked tokens count toward your effective balance. Market cap is updated every 15 minutes via a live onchain oracle.

## What is $WORD?

$WORD is the native token of Let's Have A Word. It powers the game's economy through holder bonuses, burn mechanics, and staking rewards.

Tap the **$WORD** button in the nav bar to view your balance, staking, and tokenomics.

## How does the $WORD token work in-game?

$WORD is the game's token on Base. It ties into gameplay in a few ways:

- **Bonus guesses**: Hold 100M+ $WORD to earn extra free guesses daily
- **Bonus word rewards**: Find a bonus word and receive 5M $WORD
- **Burn word deflation**: Burn words permanently destroy 5M $WORD from the supply
- **Top 10 $WORD rewards**: The top 10 guessers in each round earn $WORD payouts in addition to ETH
- **Staking**: Lock your $WORD in the WordManager contract to earn streaming staking rewards

## How does the share bonus work?

Share your guess on Farcaster or Base **once per day** to earn **+1 free guess**. The bonus is applied automatically after you cast.

## How are paid guesses different?

Paid guesses:
- Cost ETH
- Increase the global prize pool
- Can be used anytime within the daily window (until the 11:00 UTC reset), even if a new round starts

## How much do guess packs cost?

Each pack contains **3 guesses**, available in 1-pack and 3-pack sizes. Pricing has two components:

**Stage-based pricing** (based on total guesses in round):
- 0–849 guesses (early): 0.00040 ETH base
- 850–1249 guesses (mid): 0.00060 ETH base
- 1250+ guesses (late): 0.00080 ETH base

**Volume-based multipliers** (based on daily purchases):
- Packs 1–3: 1× base price
- Packs 4–6: 1.5× base price
- Packs 7+: 2× base price

Pack purchases are **unlimited** — there's no daily cap. Volume multipliers reset at 11:00 UTC along with paid guess expiration.

## What happens to my unused guesses?

- Free guesses reset daily at **11:00 UTC**
- Paid guess credits expire at the end of each day (**11:00 UTC**)
- If a round ends and a new round starts on the same day, unused paid guesses carry over

---

## How is the prize pool split?

When a round is won, the prize pool is distributed atomically onchain in a single transaction:

- **80%** → Jackpot winner
- **10%** → Top 10 Early Guessers
- **5%** → Referrer (if one exists)
- **5%** → Next round seed

If the winner **does not** have a referrer:
- **2.5%** of the referrer share is added to the Top 10 pool
- **2.5%** is added to the next round seed
- Next round seed is capped at 0.02 ETH
- Any overflow above the cap goes to the treasury

Self-referrals are blocked. Null or zero referrers are treated as "no referrer."

## How do Top 10 rewards work?

Top 10 rewards are based on **early participation** in each round.

- Only the first **850 guesses** in a round are eligible for Top 10 ranking
- After guess #850, Top 10 locks
- Guesses after the lock can still win the jackpot, but do not affect Top 10 ranking

This incentivizes early guess purchasing during the high-uncertainty phase of the round and helps drive prize pool growth.

**Even if you don't win the jackpot, heavy participation can still pay.**

## How are Top 10 rewards split?

The Top 10 pool is split using fixed percentages:

- Rank #1: 19%
- Rank #2: 16%
- Rank #3: 14%
- Rank #4: 11%
- Rank #5: 10%
- Ranks #6–10: 6% each

This distribution is fixed and always applies when a round is resolved, scaling proportionally with the total Top 10 pool.

## How do referrals work?

Share your unique referral link with friends or on the timeline. If anyone who joins using your link **ever wins a jackpot**, you'll automatically receive **5% of that round's prize pool**.

You can track your referrals and earnings in the Refer sheet.

---

## What is the WordManager contract?

Let's Have A Word uses **two smart contracts on Base** to handle different parts of the game's onchain mechanics:

- **JackpotManager** (`0xfcb0D07a5BB5f004A1580D5Ae903E33c4A79EdB5`) — Manages ETH prize pools, payouts, and the secret word's SHA-256 commitment. When a round is won, this contract distributes the jackpot, Top 10 rewards, referrer share, and next round seed in a single atomic transaction.

- **WordManager** — Manages $WORD token mechanics including bonus word rewards, burn word destruction, keccak256 word commitments, and Synthetix-style streaming staking rewards. All 15 bonus and burn words are committed to this contract before a round starts. When a player finds one, the contract verifies the guess against the committed hash before releasing or burning tokens.

Together, these contracts ensure that both ETH prizes and $WORD token mechanics are handled transparently onchain.

---

## Why can't I play? / What are the eligibility requirements?

Let's Have A Word has multiple layers of bot prevention. To play, your account needs to clear all of them. They exist because — like any game with real ETH payouts — coordinated bot farms try to flood guesses to win the jackpot by chance. Each layer below targets a different sybil signal, so a real player passes all of them while an attacker has to defeat each one.

**1. Neynar user quality score ≥ 0.55**

A score from Farcaster's reputation system reflecting account authenticity (onchain activity, social connections, account history). Below 0.55, you can't submit guesses or buy packs.
Learn more: https://docs.neynar.com/docs/neynar-user-quality-score#faqs

**2. Farcaster account age ≥ 14 days**

Your FID (the underlying Farcaster account ID) must have been registered at least 14 days before the round you're playing in. Source of truth is the Farcaster Hub's onchain registry — we don't trust self-reported timestamps.

**3. Connected wallet has real onchain history**

Your connected wallet needs a meaningful number of outgoing transactions on Base. A wallet that was just deployed and never used for anything else won't qualify. If you're using a brand-new wallet, transact on Base for a bit (a few token swaps, NFT mints, anything genuine) and try again.

**4. Winner-eligibility re-check**

Even if a guess somehow gets through the gates above, when a player guesses the secret word the eligibility checks run a second time before the round resolves. If the would-be winner doesn't pass, the round simply continues — no jackpot is paid out, and another player can still win.

If you can't play and you're a real human, the most common cause is a brand-new Farcaster account or a wallet you've never used outside this game. Activity on Farcaster and Base over time will fix both.

## How many possible words are there?

Let's Have A Word uses a custom list of **4,438** five-letter words.

This list is curated by the game's creator and is not the same as Wordle's or any other off-the-shelf word list. Unlike Wordle, which uses separate lists for answers and valid guesses, Let's Have A Word uses a single canonical list.

While there are 12,000+ five-letter entries if you include every possible dictionary term, most of those are obscure or non-standard. The game's list is intentionally curated to keep gameplay fair, challenging, and fun (have you found any easter eggs?).

## What is XP for?

XP boosts your staking rewards. Your lifetime XP determines your **staking tier**, which multiplies the $WORD you earn from staking:

- **Passive** (0 XP) — 1.00x multiplier
- **Bronze** (1,000 XP) — 1.15x multiplier
- **Silver** (5,000 XP) — 1.35x multiplier
- **Gold** (15,000 XP) — 1.60x multiplier

XP may unlock additional perks in the future.

## What is $WORD staking?

Staking lets you lock your $WORD tokens in the WordManager contract to earn streaming staking rewards. Rewards are distributed proportionally to all stakers every second during active reward periods.

Staked tokens count toward your **effective balance** for holder tier calculations, so staking can help you reach a higher bonus tier without buying more tokens.

Manage staking from the $WORD sheet (tap $WORD in the nav).

## Do top 10 players earn $WORD too?

**Yes!** In addition to ETH payouts, the Top 10 Early Guessers receive $WORD token rewards distributed via the WordManager contract.

The $WORD Top 10 distribution follows the same ranking percentages as ETH (19% for #1, 16% for #2, etc.), with the total pool amount scaling with market cap.

## How does the $WORD fee distribution work?

The $WORD ecosystem has a built-in fee structure:

- **50%** → Game Treasury (operations, development)
- **25%** → Buyback & Stake (market support)
- **15%** → Player Rewards (bonus/burn/top 10)
- **10%** → Top 10 Referral rewards

View the full tokenomics breakdown in the $WORD sheet.

## How do I buy $WORD?

Tap the **Buy $WORD** button in the $WORD sheet. If you're playing in a Farcaster client, this opens the native token swap interface. Otherwise, it opens DexScreener where you can swap on Base.

$WORD is an ERC-20 token on Base (address: 0x304e649e69979298BD1AEE63e175ADf07885fb4b).

## Can I play outside of Farcaster?

Let's Have A Word! uses the Farcaster stack. You can play in Farcaster clients and the Base app, which share the same identity and wallet infrastructure.

Standalone web play isn't supported yet. A standalone web version may be explored later.
