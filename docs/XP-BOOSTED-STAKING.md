# Design: XP-Boosted Staking Rewards for $WORD Stakers

## Context

Currently, XP is tracked but **unused** -- the XPSheet component shows "Coming Soon" for progression features. The idea is that when staking goes live (WordManager contract already has the interface defined), a player's in-game XP should boost their staking rewards, creating a flywheel: **play more -> earn more XP -> boost staking yield -> incentivize holding $WORD -> play more**.

This rewards active players over passive stakers, making the game central to the token economy rather than just a sideshow.

## Current XP Economy (Numbers That Matter)

| Player Type | Daily XP | Monthly XP (30d) |
|-------------|----------|-------------------|
| Casual (1 guess, streak) | ~27 | ~810 |
| Regular (4 guesses, streak, share, holder) | ~58 | ~1,740 |
| Active (above + 3 packs/day) | ~136 | ~4,080 |
| Active + 1 win/month | -- | ~6,580 |

Key XP sources: GUESS (2), DAILY_PARTICIPATION (10), STREAK_DAY (15), SHARE_CAST (15), CLANKTON_BONUS_DAY (10), PACK_PURCHASE (20/pack), WIN (2,500), BONUS_WORD (250), TOP_TEN (50).

## Recommended Model: All-Time XP Tiers

Use **total lifetime XP** to place stakers into boost tiers. Earned XP is earned XP -- it never decays. This rewards long-term loyalty and doesn't punish players for taking a break.

| Tier | Name | Total XP | Boost | How Long to Reach |
|------|------|----------|-------|-------------------|
| 0 | Passive | 0 | 1.0x | Never played |
| 1 | Bronze | 1,000+ | 1.15x | ~2 weeks regular play |
| 2 | Silver | 5,000+ | 1.35x | ~3 months casual / ~5 weeks regular |
| 3 | Gold | 15,000+ | 1.60x | ~6 months regular / ~3.5 months active |

### XP Accumulation Reference

| Player Type | Daily XP | 1 Month | 3 Months | 6 Months | 1 Year |
|-------------|----------|---------|----------|----------|--------|
| Casual (~27/day) | ~27 | ~810 | ~2,430 | ~4,860 | ~9,720 |
| Regular (~58/day) | ~58 | ~1,740 | ~5,220 | ~10,440 | ~21,170 |
| Active (~136/day) | ~136 | ~4,080 | ~12,240 | ~24,480 | ~49,640 |

*Wins add ~2,500 each. Bonus words add ~250 each.*

### How Rewards Are Calculated

```
effective_stake(user) = staked_amount * tier_multiplier
reward(user) = (effective_stake / total_effective_stake) * reward_pool
```

### Worked Example

Pool: 100,000 $WORD/month. Three stakers with 10M $WORD each:

| Player | Total XP | Tier | Boost | Effective Stake | Share | Reward |
|--------|----------|------|-------|-----------------|-------|--------|
| Alice (staker, never plays) | 0 | 0 | 1.0x | 10M | 28.2% | 28,169 |
| Bob (2-month casual) | 1,620 | 1 | 1.15x | 11.5M | 32.4% | 32,394 |
| Carol (6-month regular) | 10,440 | 2 | 1.35x | 13.5M | 38.0% | 38,028 |
| Dave (1-year active) | 49,640 | 3 | 1.60x | 16M | -- | -- |

Carol earns **35% more** than Alice with the same stake. A Gold-tier player earns **60% more**.

### Why This Model

1. **Simple**: 4 clean tiers, easy to show in UI ("You're Silver -- 3,800 XP to Gold")
2. **Rewards loyalty**: Long-term players accumulate a permanent advantage that reflects genuine commitment
3. **No decay anxiety**: Take a vacation without worrying about losing your tier
4. **Fair progression**: A regular daily player reaches Gold in ~6 months. An active player in ~3.5 months. Even casual players hit Silver within a year
5. **Not gameable via pack purchases**: Buying to Gold purely via packs = 750 packs = 0.225 ETH (~$600). Completely uneconomical
6. **Upgradeable**: Can add more tiers later as the XP ceiling rises with the player base

### Minimum Stake Requirement

Uses the **existing holder tier thresholds** (market-cap-scaled) as the minimum stake to qualify for XP boost:

| Market Cap | Min Stake for Boost |
|-----------|-------------------|
| < $150K | 100M $WORD |
| $150K-$300K | 50M $WORD |
| >= $300K | 25M $WORD |

Below the minimum, stakers earn base rewards (1.0x) regardless of XP. This aligns with the existing holder bonus system and prevents dust-amount staking from capturing boosted yields.

### Reward Type & Distribution

- **Staking rewards are $WORD only.** Stakers earn $WORD, not ETH. ETH economics (jackpots, fee recipients) are entirely separate.
- **Real-time accrual UI**: Rewards appear to accumulate in real-time in the UI (a ticking counter showing earned $WORD). This creates a satisfying visual of rewards growing.
- **Distributed on unstake only**: Actual $WORD transfer happens when the user unstakes. No periodic distribution transactions, no gas overhead for the protocol.
- This means the contract tracks `accruedRewards(user)` and settles on `withdraw()`.

### Reward Pool Source

**TBD** -- funding source to be decided separately. The mechanic (XP tier multiplier on staking yield) is designed independently of where the $WORD reward pool comes from.

### Alternative Models Considered

**Rolling 30-day window**: XP earned in last 30 days only. Keeps the system dynamic but penalizes breaks and creates "use it or lose it" anxiety. Rejected -- earned XP should stay earned.

**Continuous curve** (logarithmic): Fairer mathematically but harder for players to understand. No clear "levels" to chase.

**Tier + Streak hybrid**: Adds a second dimension (consecutive days played). More engaging but more complex. Better as a v2 upgrade once the base system is proven.

## Key Files

| File | Role |
|------|------|
| `config/economy.ts` | Add staking tier constants (alongside existing holder tiers) |
| `src/lib/xp.ts` | Already has `getTotalXpForFid(fid)` -- reuse directly |
| `src/lib/word-manager.ts` | WordManager contract interface (V3: `stakedBalance`, `earned`, `notifyRewardAmount`, `getReward`) |
| `src/lib/fee-recipients.ts` | Defines Player Rewards pool (15%) |
| `src/types/index.ts` | Add staking boost types |

## Decisions Made

- **Reward pool source**: Design only for now -- funding mechanism TBD
- **Minimum stake**: Match existing holder tier thresholds (market-cap-scaled)
- **Reward type**: $WORD only. ETH is entirely separate (jackpots, fees)
- **Distribution**: Real-time accrual in UI, actual transfer on unstake only
- **XP window**: All-time (no rolling window -- earned XP stays earned)

## Verification (When Implemented)

- Unit test: tier calculation with boundary XP values (0, 999, 1000, 4999, 5000, 14999, 15000)
- Unit test: accrued reward math with mixed tiers and varying stake amounts
- Admin endpoint: view all stakers' tiers, XP, accrued $WORD rewards, and effective multipliers
- UI test: real-time counter increments visually while staked
