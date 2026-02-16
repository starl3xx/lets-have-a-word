# Let's Have A Word!

**The massively multiplayer word hunt where everyone eliminates wrong answers until one player hits the ETH jackpot.**

---

## What is Let's Have A Word?

Let's Have A Word is a social word-guessing game on Farcaster where players worldwide compete to guess the same secret 5-letter word. Every wrong guess helps everyone else by eliminating that word from play. When someone guesses correctly, they win the ETH jackpot.

### How It Works

1. **One secret word** — Every player in the world is hunting the same 5-letter word
2. **Wrong guesses help everyone** — Incorrect guesses appear on a spinning wheel visible to all players
3. **First correct guess wins** — The round ends when someone finds the word
4. **Jackpot payout** — The winner receives ETH automatically, paid onchain

---

## Getting Started

### Where to Play

Let's Have A Word is available as a Farcaster mini app. You can play in:
- Warpcast
- Other Farcaster clients
- The Base app (which shares the same identity and wallet infrastructure)

### Eligibility Requirements

To prevent bot abuse, players must have a **Neynar user score of 0.6 or higher**. This score reflects account authenticity based on factors like onchain activity, social connections, and account history.

If your score is below the threshold, you won't be able to submit guesses or purchase packs.

Learn more about Neynar user scores: https://docs.neynar.com/docs/neynar-user-quality-score

---

## Guessing

### Daily Free Guesses

Every player gets **1 free guess per day**. Free guesses:
- Don't cost anything
- Can still win the jackpot
- Count toward Top 10 rankings
- Reset daily at **11:00 UTC**

### Earning Bonus Guesses

You can earn additional free guesses each day:

| Bonus Type | Guesses | How to Earn |
|------------|---------|-------------|
| Share Bonus | +1/day | Share your guess on Farcaster |
| $WORD Bonus | +2–3/day | Hold 100M+ $WORD tokens |

### Word Validation

- Must be exactly **5 letters**
- Must be in the game's dictionary (4,374 words)
- Cannot guess the same word twice in a round
- Case-insensitive (BRAIN = brain = BrAiN)

---

## Guess Packs

### Purchasing Guesses

You can buy guess packs for ETH. Each pack contains **3 guesses**.

Paid guesses:
- Increase the global prize pool
- Can be used anytime until the 11:00 UTC daily reset
- Carry over if a new round starts on the same day

### Pack Pricing

Pricing has two components:

**Stage-based pricing** (based on total guesses in the round):

| Round Stage | Total Guesses | Price per Pack |
|-------------|---------------|----------------|
| Early | 0–749 | 0.00030 ETH |
| Late | 750–1249 | 0.00045 ETH |
| Late Max | 1250+ | 0.00060 ETH |

**Volume-based multipliers** (based on your daily purchases):

| Packs Purchased Today | Multiplier |
|-----------------------|------------|
| 1–3 | 1× base price |
| 4–6 | 1.5× base price |
| 7+ | 2× base price |

Pack purchases are **unlimited** — there's no daily cap. Volume multipliers reset at 11:00 UTC.

### Guess Expiration

- **Free guesses** reset daily at 11:00 UTC
- **Paid guess credits** expire at 11:00 UTC
- If a round ends mid-day, unused paid guesses carry over to the new round

---

## The Prize Pool

### How It Grows

The prize pool accumulates as players purchase guess packs. Every pack purchase adds ETH to the pot.

### Prize Distribution

When a round is won, the prize pool is distributed **atomically onchain in a single transaction**:

| Recipient | Share |
|-----------|-------|
| Jackpot Winner | 80% |
| Top 10 Early Guessers | 10% |
| Winner's Referrer | 10% |

**If the winner has no referrer:**
- 7.5% is added to the Top 10 pool (making it 17.5% total)
- 2.5% seeds the next round's prize pool

There are no offchain payouts. Everything is verifiable on BaseScan.

---

## Top 10 Rewards

### How Ranking Works

Top 10 rewards are based on **early participation** in each round:

- Only the **first 750 guesses** in a round are eligible for Top 10 ranking
- After guess #750, the Top 10 locks
- Later guesses can still win the jackpot but don't affect rankings

This incentivizes early participation during the high-uncertainty phase of each round.

### Reward Distribution

The Top 10 pool is split using fixed percentages:

| Rank | Share of Pool |
|------|---------------|
| #1 | 19% |
| #2 | 16% |
| #3 | 14% |
| #4 | 11% |
| #5 | 10% |
| #6 | 6% |
| #7 | 6% |
| #8 | 6% |
| #9 | 6% |
| #10 | 6% |

**Even if you don't win the jackpot, heavy participation can still pay.**

---

## $WORD Bonus

### What Is It?

If you hold **100 million $WORD** tokens in your connected wallet, you receive extra free guesses every day:

| Market Cap | Bonus Guesses |
|------------|---------------|
| Below $250K | +2/day |
| Above $250K | +3/day |

### How It Works

- Your balance is detected automatically when you connect
- Market cap is updated every 15 minutes via a live onchain oracle
- If market cap crosses $250K mid-day, you get the upgrade immediately

**Token:** [$WORD on Base](https://basescan.org/token/0x304e649e69979298BD1AEE63e175ADf07885fb4b)

---

## Share Bonus

### Earning Your Bonus

Share your guess on Farcaster **once per day** to earn **+1 free guess**.

How it works:
1. After making a guess, you'll see a share prompt
2. Post your cast to Farcaster
3. The bonus is applied automatically after verification

The share bonus can only be earned once per day.

---

## Referrals

### How Referrals Work

Share your unique referral link with friends. If anyone who joins using your link **ever wins a jackpot**, you automatically receive **10% of that round's prize pool**.

### Key Details

- Referral rewards are paid onchain in the same transaction as the jackpot
- Self-referrals are blocked
- You can track your referrals and potential earnings in the app

---

## Provably Fair

### What Does "Provably Fair" Mean?

Before each round begins, Let's Have A Word **commits onchain** to the secret word using a cryptographic hash and hidden salt.

This commitment guarantees that the **word cannot be changed mid-round** — not by the game, not by the creator, not by anyone.

### The Commit-Reveal Process

1. **Before the round:** A hash of the secret word + salt is written to the Base blockchain
2. **During the round:** Nobody knows the word (including the creator)
3. **After the round:** The word and salt are revealed publicly
4. **Verification:** Anyone can recompute the hash and verify it matches

### Verify It Yourself

Every round can be independently verified at:
**https://letshaveaword.fun/verify**

You can also link directly to a specific round: `https://letshaveaword.fun/verify?round=42`

The verification page shows:
- The committed hash (from the database)
- The onchain commitment (from Base)
- The revealed word and salt
- Client-side hash computation for comparison

---

## Round Lifecycle

### How a Round Works

1. **Round Creation**
   - A random word is selected from the 4,374-word dictionary
   - The word's hash is committed onchain
   - The round is announced on Farcaster

2. **Guessing Phase**
   - Players submit guesses (valid 5-letter words only)
   - Wrong guesses appear on the wheel for everyone to see
   - The prize pool grows as players buy guess packs

3. **Round Resolution**
   - Someone guesses the correct word
   - Payouts are distributed atomically onchain
   - The word and salt are revealed publicly

4. **New Round**
   - A new round starts automatically with a new secret word

### Viewing Past Rounds

All past rounds, winning words, and payouts are available in the Round Archive:
**https://letshaveaword.fun/archive**

---

## XP & Progression

XP is tracked for every player. Currently, XP has no gameplay effect, but future updates may introduce leaderboards, progression systems, or XP-based rewards.

---

## Frequently Asked Questions

### Can I see the word after someone wins?

**Yes.** When a round is won, the secret word is revealed publicly by @letshaveaword on Farcaster. You can also view all past winning words in the [Round Archive](https://letshaveaword.fun/archive).

### How many possible words are there?

Let's Have A Word uses a custom list of **4,374 five-letter words**. This list is curated by the game's creator and is intentionally designed to keep gameplay fair, challenging, and fun.

### What happens to my unused guesses?

- **Free guesses** reset daily at 11:00 UTC (use them or lose them)
- **Paid guess credits** expire at 11:00 UTC
- If a round ends mid-day, unused paid guesses carry over to the new round

### Why can't I play?

You need a Neynar user score of 0.6 or higher to prevent bot abuse. If you're below this threshold, you'll see a message explaining the restriction. Learn more at [Neynar's FAQ](https://docs.neynar.com/docs/neynar-user-quality-score#faqs).

### Can I play outside of Farcaster?

Currently, Let's Have A Word uses the Farcaster stack and is available through Farcaster clients and the Base app. A standalone web version may be explored in the future.

### Is the game fair?

Yes. Every round uses cryptographic commit-reveal to ensure the word cannot be changed after the round starts. Anyone can verify this at https://letshaveaword.fun/verify.

### How do I earn more guesses?

1. **Share your guess** on Farcaster (+1 free guess per day)
2. **Hold 100M $WORD** tokens (+2–3 guesses per day)
3. **Purchase guess packs** (3 guesses per pack, unlimited purchases)

### What if I don't win the jackpot?

You can still earn rewards through the **Top 10 Early Guessers** pool. If you're among the first 750 guessers and rank in the top 10 by guess count, you'll receive a share of 10-17.5% of the prize pool.

### How do I refer friends?

Share your unique referral link (found in the app). If anyone who signs up with your link ever wins a jackpot, you'll automatically receive 10% of that round's prize pool.

---

## Smart Contract

All prize payouts are handled by the JackpotManager smart contract on Base:

**Proxy Address:** `0xfcb0D07a5BB5f004A1580D5Ae903E33c4A79EdB5`

The contract handles:
- Round commitments (storing answer hashes)
- Prize pool accumulation
- Atomic multi-recipient payouts (winner, referrer, Top 10)

All transactions are verifiable on [BaseScan](https://basescan.org/address/0xfcb0D07a5BB5f004A1580D5Ae903E33c4A79EdB5).

---

## Links

- **Play:** Farcaster mini app
- **Archive:** https://letshaveaword.fun/archive
- **Verify:** https://letshaveaword.fun/verify
- **Follow:** [@letshaveaword on Farcaster](https://warpcast.com/letshaveaword)
- **$WORD:** [Token on Base](https://basescan.org/token/0x304e649e69979298BD1AEE63e175ADf07885fb4b)

---

*Let's Have A Word! — The word hunt where everyone's wrong guesses are your gain.*
