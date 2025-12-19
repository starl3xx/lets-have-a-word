# Let's Have A Word! — Canonical Economics Specification

This document defines the **single source of truth** for prize pools, payouts, referrals, and Top-10 reward distribution in *Let's Have A Word!*.

---

## 1. Overview

Each round accumulates an onchain prize pool funded by guess purchases.
When the secret word is solved, the round is **resolved atomically onchain in a single transaction**, distributing rewards according to the rules below.

There are **no offchain payouts** and no manual intervention.

---

## 2. High-Level Payout Split (100%)

### Base allocation
- **80%** → Jackpot winner (secret word guesser)
- **10%** → Top-10 guessers pool
- **10%** → Referral pool (conditional)

---

## 3. Referral Logic

### If the jackpot winner **has a valid referrer**
- Referrer receives the full **10%**

### If the jackpot winner **does NOT have a referrer**
- **7.5%** is added to the Top-10 guessers pool
- **2.5%** is rolled into the **next round's seed prize pool**

### Notes
- Self-referrals are blocked at signup
- Null or zero referrer is treated as "no referrer"

---

## 4. Resulting Outcomes

### With referrer
| Recipient | Share |
|-----------|-------|
| Winner | 80% |
| Top-10 guessers | 10% |
| Referrer | 10% |

### Without referrer
| Recipient | Share |
|-----------|-------|
| Winner | 80% |
| Top-10 guessers | 17.5% |
| Next round seed | 2.5% |

---

## 5. Top-10 Guessers Distribution (Canonical)

Let `T` be the total Top-10 pool for the round
(`T = 10%` or `17.5%` of the prize pool, depending on referral outcome)

### Fixed percentage split (scales with prize size)

| Rank | Share of T | Basis Points |
|------|------------|--------------|
| #1 | 19% | 1900 |
| #2 | 16% | 1600 |
| #3 | 14% | 1400 |
| #4 | 11% | 1100 |
| #5 | 10% | 1000 |
| #6 | 6% | 600 |
| #7 | 6% | 600 |
| #8 | 6% | 600 |
| #9 | 6% | 600 |
| #10 | 6% | 600 |
| **Total** | **100%** | **10000** |

This structure guarantees:
- Ranks **6–10** earn a meaningful "one-pack back" at typical pool sizes
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
- The Top-10 pool is paid to the jackpot winner

---

## 7. Rounding & Dust

- All calculations are performed in **wei** using integer math
- Division rounds down (never overpays)
- Any remainder is deterministically assigned to rank #1
- Maximum trapped dust is negligible (~3 wei per round)
- Dust accumulation is non-exploitable and cosmetic only

---

## 8. Execution Guarantees

- Single atomic onchain transaction
- Resolve callable exactly once per round
- Non-reentrant payout logic
- Round must be ended before resolve
- Backend supplies ordered Top-10 list only; contract enforces payouts

---

## 9. Trust & Transparency

- All economics are enforced onchain
- No discretionary payouts
- No backend reconciliation
- Anyone can verify payouts via BaseScan

---

## 10. Design Intent

This model is designed to:
- Strongly reward the solver
- Make Top-10 participation consistently feel worth it
- Encourage referrals without penalizing non-referred rounds
- Scale cleanly from small to large prize pools
- Remain simple enough to explain without math in the UI

---

## Implementation References

| Component | Location |
|-----------|----------|
| Smart contract | `contracts/src/JackpotManager.sol` |
| Tiered payout calculation | `src/lib/top-guesser-payouts.ts` |
| Round resolution logic | `src/lib/economics.ts` |
| Contract integration | `src/lib/jackpot-contract.ts` |

---

**This document is canonical.**
*Last updated: Milestone 6.9b*
