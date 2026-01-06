# Let's Have A Word! – FAQ

## How does the game work?

Every **Let's Have A Word!** player worldwide is hunting the same secret 5-letter word. Every incorrect guess helps everyone else by removing that word from play.

The **prize pool** is the total ETH collected during a round as players purchase guess packs. When someone guesses correctly, the round ends and the **jackpot** — the winner's share of the prize pool — is paid out automatically onchain. A new round then starts with a new secret word.

## Can I see the word after someone wins?

**Yes.** When a round is won, the secret word is revealed publicly by @letshaveaword.

You can view all past winning words, round details, and payouts in the Round Archive:
https://letshaveaword.fun/archive

You can also independently verify each round's cryptographic commitment and reveal at:
https://letshaveaword.fun/verify

## What does "provably fair" mean?

Before each round begins, Let's Have A Word **commits onchain** to the secret word using a cryptographic hash and hidden salt.

This commitment guarantees that the **word cannot be changed mid-round** — not by the game, not by the creator, not by anyone. Importantly, **the creator does not know the secret word while the round is live**. The word is only revealed after someone finds it.

When a round ends:
- The secret word and salt are revealed by @letshaveaword
- Anyone can recompute the hash
- Anyone can verify the answer was fixed from the very start

You don't have to trust this; you can verify every round yourself at:
https://letshaveaword.fun/verify

This commit–reveal process makes every round transparent, verifiable, and fair.

---

## What are free guesses?

Every player gets **1 free guess per day**. Free guesses don't cost anything (obvs) but can still win the jackpot. Free guesses **are** counted in the Top 10 Early Guessers ranking.

Free guesses reset daily at **11:00 UTC**.

## How do I get more guesses?

You can earn bonus free guesses by:
1. Sharing your daily guess on Farcaster (+1 guess/day)
2. Holding 100M CLANKTON tokens (+2–3 guesses/day depending on market cap)

You can also purchase paid guess packs (3 guesses per pack, unlimited purchases with volume-based pricing).

## What's the CLANKTON bonus?

If you hold 100M [$CLANKTON](https://farcaster.xyz/~/token/eip155:8453/erc20:0x461DEb53515CaC6c923EeD9Eb7eD5Be80F4e0b07) in your connected wallet, you receive extra free guesses:

- **+2 guesses/day** when $CLANKTON market cap is below $250K
- **+3 guesses/day** when market cap is above $250K

This is detected automatically when you connect. Market cap is updated every 15 minutes via a live onchain oracle.

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
- 0–749 guesses (early): 0.00030 ETH base
- 750–1249 guesses (late): 0.00045 ETH base
- 1250+ guesses (late max): 0.00060 ETH base

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
- The 5% referrer share is redirected to the next round seed
- Next round seed is capped at 0.03 ETH
- Any overflow above the cap goes to the creator

Self-referrals are blocked. Null or zero referrers are treated as "no referrer."

## How do Top 10 rewards work?

Top 10 rewards are based on **early participation** in each round.

- Only the first **750 guesses** in a round are eligible for Top 10 ranking
- After guess #750, Top 10 locks
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

## Why can't I play? / What are the eligibility requirements?

To prevent bot abuse, players must meet a minimum **Neynar user score of 0.6 or higher**. This score reflects account authenticity based on factors like onchain activity, social connections, and account history.

If your score is below the required threshold, you won't be able to submit guesses or purchase packs, and you'll see a message explaining the restriction.

Learn more about Neynar user scores and how to improve them:
https://docs.neynar.com/docs/neynar-user-quality-score#faqs

## How many possible words are there?

Let's Have A Word uses a custom list of **4,374** five-letter words.

This list is curated by the game's creator and is not the same as Wordle's or any other off-the-shelf word list. Unlike Wordle, which uses separate lists for answers and valid guesses, Let's Have A Word uses a single canonical list.

While there are 12,000+ five-letter entries if you include every possible dictionary term, most of those are obscure or non-standard. The game's list is intentionally curated to keep gameplay fair, challenging, and fun (have you found any easter eggs?).

## What is XP for?

XP is tracked but currently has no gameplay effect. Future updates may introduce leaderboards, progression, or XP-based rewards. I don't really know yet, tbh.

## Can I play outside of Farcaster?

Let's Have A Word! uses the Farcaster stack. You can play in Farcaster clients and the Base app, which share the same identity and wallet infrastructure.

Standalone web play isn't supported yet. A standalone web version may be explored later.
