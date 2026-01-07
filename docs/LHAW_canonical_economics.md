# Let's Have A Word! — Canonical Economics Specification

This document defines the **single source of truth** for prize pools, payouts, referrals, and Top 10 reward distribution in *Let's Have A Word!*.

---

## 1. Overview

Each round accumulates an onchain prize pool funded by guess purchases.
When the secret word is solved, the round is **resolved atomically onchain in a single transaction**, distributing rewards according to the rules below.

There are **no offchain payouts** and no manual intervention.

---

## 2. High‑Level Payout Split (100%)

### Base allocation
- **80%** → Jackpot winner (secret word guesser)
- **10%** → Top 10 guessers pool
- **10%** → Referral pool (conditional)

---

## 3. Referral Logic

### If the jackpot winner **has a valid referrer**
- Referrer receives the full **10%**

### If the jackpot winner **does NOT have a referrer**
- **2.5%** is added to the Top 10 guessers pool
- **7.5%** is rolled into the **next round's seed prize pool**

### Notes
- Self‑referrals are blocked at signup
- Null or zero referrer is treated as "no referrer"

---

## 4. Resulting Outcomes

### With referrer
- Winner: **80%**
- Top 10 guessers: **10%**
- Referrer: **10%**

### Without referrer
- Winner: **80%**
- Top 10 guessers: **12.5%**
- Next round seed: **7.5%**

---

## 5. Top 10 Guessers Distribution

Let `T` be the total Top 10 pool for the round
(`T = 10%` or `12.5%` of the prize pool, depending on referral outcome)

### Eligibility lock

Top 10 ranking is based on **early-round participation**.

- Only the **first 850 guesses** in a round are **Top 10 eligible** (was 750 for rounds 1-3)
- After guess #850, **Top 10 locks** for that round
- Guesses after the lock can still win the jackpot, but **do not affect Top 10 ranking**

Enforcement:
- Eligibility is enforced by the backend when constructing the ordered `topGuessers[]` list
- Payouts remain fully onchain at round resolution

### Fixed percentage split (scales with prize size)

| Rank | Share of T |
|----|----|
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

**Total: 100%**

This structure guarantees:
- Ranks **6–10** earn a meaningful "one‑guess-pack-back" at typical pool sizes
- Ranks **1–5** always earn more than ranks 6–10
- Rewards scale proportionally as prize pools grow

---

## 6. Fewer Than 10 Eligible Guessers

If fewer than 10 eligible top guessers exist:
- Use the first `N` ranks of the above distribution
- Renormalize percentages so payouts sum to 100%
- Preserve rank ordering
- Any rounding remainder ("dust") is assigned to rank #1

If **zero** eligible top guessers exist:
- The Top 10 pool is paid to the jackpot winner

---

## 7. Guess Pack Pricing (Canonical)

Guess packs are priced dynamically based on round progress.

### Pack definition
- 1 pack = **3 guesses**

### Base price
- Base pack price: **0.00030 ETH** (per pack)

### Stage-based pricing
Pack price increases at round milestones (aligned with Top 10 lock at guess #850), then caps.

| Total guesses in round | Stage | Pack price (ETH) |
|---|---|---:|
| 0–849 | Early | 0.00030 |
| 850–1249 | Mid | 0.00045 |
| 1250+ | Late | 0.00060 |

Implementation notes:
- Pricing is computed **server-side at purchase time** from the authoritative `totalGuessesInRound`
- UI must display the backend-returned price and totals
- Pack purchases continue to fund the round prize pool per existing rules


## 8. Rounding & Dust

- All calculations are performed in **wei** using integer math
- Division rounds down (never overpays)
- Any remainder is deterministically assigned to rank #1
- Maximum trapped dust is negligible (~3 wei per round)
- Dust accumulation is non‑exploitable and cosmetic only

---

## 9. Execution Guarantees

- Single atomic onchain transaction
- Resolve callable exactly once per round
- Non‑reentrant payout logic
- Round must be ended before resolve
- Backend supplies ordered Top 10 list only; contract enforces payouts

---

## 10. Trust & Transparency

- All economics are enforced onchain
- No discretionary payouts
- No backend reconciliation
- Anyone can verify payouts via BaseScan

---

## 11. Design Intent

This model is designed to:
- Strongly reward the solver
- Make Top 10 participation consistently feel worth it
- Encourage referrals without penalizing non‑referred rounds
- Scale cleanly from small to large prize pools
- Remain simple enough to explain without math in the UI

---

**This document is canonical.**
