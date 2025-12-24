# Let's Have A Word - FAQ

## How does the game work?

Every **Let's Have A Word!** player worldwide is hunting the same secret 5-letter word. Every incorrect guess helps everyone else by removing that word from play. When someone guesses correctly, they win the ETH jackpot, the prize pool is automatically distributed onchain, and a new round starts with a new secret word. The prize pool grows as players purchase guess packs.

## What are free guesses?

Every player gets 1 free guess per day. Free guesses don't cost anything (obvs) but can still win the jackpot. You can earn additional free guesses through bonuses. Free guesses **are** counted in Top 10 Early Guessers ranking. Free guesses reset daily at 11:00 UTC.

## How do I get more guesses?

You can earn bonus free guesses by: (1) Holding 100M CLANKTON tokens (+2-3 guesses/day depending on market cap), and (2) Sharing your daily guess on Farcaster (+1 guess/day). You can also purchase paid guess packs (3 guesses/pack, up to 3 packs/day).

## What's the CLANKTON bonus?

If you hold 100M [$CLANKTON](https://farcaster.xyz/~/token/eip155:8453/erc20:0x461DEb53515CaC6c923EeD9Eb7eD5Be80F4e0b07) in your connected wallet, you receive extra free guesses:
- **+2 guesses/day** when $CLANKTON market cap is below $250K
- **+3 guesses/day** when market cap is above $250K

This is detected automatically when you connect. Market cap is updated every 15 minutes via live onchain oracle.

## How does the share bonus work?

Share your guess via Farcaster once per day to earn +1 free guess. The bonus is applied automatically after you cast.

## How are paid guesses different?

Paid guesses function the same as free guesses but:
- Cost ETH
- Increase the global prize pool
- Can be used at any point during the round

## How much do guess packs cost?

Each pack contains 3 guesses and are priced as follows:
- **0–749 total guesses** (early round): 0.00030 ETH
- **750–1249 guesses** (late round): 0.00045 ETH
- **1250+ guesses** (late round, max): 0.00060 ETH

Pack prices increase only after Top 10 locks. Pricing is computed server-side at purchase time and displayed in the UI.

## How is the prize pool split?

When a round is won, payouts are resolved atomically onchain in a single transaction:
- **80%** → Jackpot winner
- **10%** → Top 10 early guessers
- **10%** → Referrer (if one exists)

If the winner *does not* have a referrer:
- 7.5% is added to the Top 10 pool
- 2.5% seeds the next round's prize pool

Self-referrals are blocked. Null or zero referrers are treated as "no referrer."

## What does "provably fair" mean?

Before each round, the game commits to the secret answer by publishing a cryptographic hash of the word (combined with a hidden salt) onchain. This hash proves the answer was fixed from the start and cannot be changed after guesses begin.

When the round ends, @letshaveaword reveals the winning word and the salt, allowing anyone to recompute the hash themselves and verify it matches the original onchain commitment. This "commit–reveal" process makes every round transparently and mathematically fair.

## How do referrals work?

Share your referral link with your Farcaster friends. If someone you referred ever wins a jackpot, you'll automatically receive 10% of their winnings. You can track your referral earnings in the Refer sheet.

## Why can't I play? / What are the eligibility requirements?

To prevent bot abuse, players must meet a minimum **Neynar user score of 0.6 or higher.** This score reflects account authenticity based on factors like onchain activity, social connections, and account history.

If your score is below the required threshold, you won't be able to submit guesses or purchase packs, and you'll see a message explaining the restriction.

Learn more about Neynar user scores and how to improve them:
https://docs.neynar.com/docs/neynar-user-quality-score#faqs

## What happens to my unused guesses?

Free guess allocations reset daily at 11:00 UTC. Paid guess credits expire at the end of each day. Use them or lose them! If a round is won and a new round starts, any unused paid guess credits automatically carry over to the next round.

## Can I see the word after someone wins?

Yes! When a round is won, the answer is revealed to everyone by @letshaveaword. You can also view past winning words and their cryptographic proofs.

## What is XP for?

XP is currently being tracked but has no gameplay effect yet. Future updates may add leaderboards, progression systems, or XP-based rewards. Who knows!

## Can I play outside of Farcaster?

Not yet. Let's Have A Word is Farcaster-only for now. The game uses your Farcaster identity, signer wallet, spam score, and referral graph to keep the game fair and to prevent bot abuse. Therefore, the game only works when launched inside a Farcaster client.

I (@starl3xx) may explore a standalone web version later, but the current experience and security model are built specifically for Farcaster's ecosystem.
