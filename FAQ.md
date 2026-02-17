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

## How does the $WORD token work in-game?

$WORD is the game's token on Base. It ties into gameplay in a few ways:

- **Bonus guesses**: Hold 100M+ $WORD to earn extra free guesses daily
- **Bonus word rewards**: Find a bonus word and receive 5M $WORD
- **Burn word deflation**: Burn words permanently destroy 5M $WORD from the supply
- **Top 10 $WORD rewards**: The top 10 guessers in each round earn $WORD payouts in addition to ETH
- **Staking**: Coming soon

## How does the share bonus work?

Share your guess on Farcaster or Base **once per day** to earn **+1 free guess**. The bonus is applied automatically after you cast.

## How are paid guesses different?

Paid guesses:
- Cost ETH
- Increase the global prize pool
- Can be used anytime within the daily window (until the 11:00 UTC reset), even if a new round starts

## How much do guess packs cost?

Each pack contains **3 guesses**. Pricing has two components:

**Stage-based pricing** (based on total guesses in round):
- 0–849 guesses (early): 0.00030 ETH base
- 850–1249 guesses (mid): 0.00045 ETH base
- 1250+ guesses (late): 0.00060 ETH base

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
- Next round seed is capped at 0.03 ETH
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

To prevent bot abuse, players must meet a minimum **Neynar user score of 0.55 or higher**. This score reflects account authenticity based on factors like onchain activity, social connections, and account history.

If your score is below the required threshold, you won't be able to submit guesses or purchase packs, and you'll see a message explaining the restriction.

Learn more about Neynar user scores and how to improve them:
https://docs.neynar.com/docs/neynar-user-quality-score#faqs

## How many possible words are there?

Let's Have A Word uses a custom list of **4,438** five-letter words.

This list is curated by the game's creator and is not the same as Wordle's or any other off-the-shelf word list. Unlike Wordle, which uses separate lists for answers and valid guesses, Let's Have A Word uses a single canonical list.

While there are 12,000+ five-letter entries if you include every possible dictionary term, most of those are obscure or non-standard. The game's list is intentionally curated to keep gameplay fair, challenging, and fun (have you found any easter eggs?).

## What is XP for?

XP is tracked but currently has no gameplay effect. Future updates may introduce leaderboards, progression, or XP-based rewards. I don't really know yet, tbh.

## Can I play outside of Farcaster?

Let's Have A Word! uses the Farcaster stack. You can play in Farcaster clients and the Base app, which share the same identity and wallet infrastructure.

Standalone web play isn't supported yet. A standalone web version may be explored later.
