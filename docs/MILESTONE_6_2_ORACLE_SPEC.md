# Milestone 6.2 - CLANKTON Market Cap Oracle Integration

## Overview

This milestone implements a live oracle for CLANKTON token market cap, replacing the current environment variable configuration. The oracle will feed market cap data to the JackpotManager contract to enable automatic bonus tier adjustments.

## Current State (Milestone 6.1)

- Market cap is configured via `CLANKTON_MARKET_CAP_USD` environment variable
- Backend determines bonus tier based on env value
- Contract has placeholder `updateClanktonMarketCap()` function

## Oracle Requirements

### Data Source Options

1. **DEX-Based Oracle (Recommended)**
   - Query Uniswap V3 / Aerodrome pool on Base
   - Calculate market cap from: `price * total supply`
   - TWAP for manipulation resistance

2. **Chainlink Integration**
   - If CLANKTON gets a Chainlink price feed
   - More reliable but requires Chainlink support

3. **Custom Oracle Service**
   - Backend polls DEXes and pushes to contract
   - Simpler but more centralized

### Contract Updates Needed

```solidity
// New state variables
uint256 public clanktonMarketCapUsd;
uint256 public lastMarketCapUpdate;
uint256 public constant MARKET_CAP_STALENESS_THRESHOLD = 1 hours;

// Market cap threshold for bonus tier
uint256 public constant MARKET_CAP_TIER_THRESHOLD = 250_000 * 1e8; // $250k with 8 decimals

// Bonus tier enum
enum BonusTier { LOW, HIGH }

// Update function (operator or oracle)
function updateClanktonMarketCap(uint256 marketCapUsd) external onlyOperator {
    clanktonMarketCapUsd = marketCapUsd;
    lastMarketCapUpdate = block.timestamp;
    emit MarketCapUpdated(marketCapUsd, block.timestamp);
}

// View function for bonus tier
function getCurrentBonusTier() external view returns (BonusTier) {
    if (clanktonMarketCapUsd >= MARKET_CAP_TIER_THRESHOLD) {
        return BonusTier.HIGH; // 3 free guesses
    }
    return BonusTier.LOW; // 2 free guesses
}
```

### Backend Integration

```typescript
// src/lib/clankton-oracle.ts

/**
 * Fetch CLANKTON market cap from DEX
 *
 * Options:
 * 1. Aerodrome on Base (if CLANKTON has pool)
 * 2. Uniswap V3 on Base
 * 3. External API aggregator (DexScreener, CoinGecko)
 */
export async function fetchClanktonMarketCap(): Promise<number> {
  // Implementation TBD
}

/**
 * Update market cap on contract
 * Called by cron job or webhook
 */
export async function pushMarketCapToContract(): Promise<void> {
  const marketCap = await fetchClanktonMarketCap();
  const contract = getJackpotManagerWithOperator();

  // Convert to 8 decimals (contract format)
  const marketCapScaled = Math.floor(marketCap * 1e8);

  await contract.updateClanktonMarketCap(marketCapScaled);
}
```

### Bonus Tier Logic

| Market Cap | Bonus Tier | Free Guesses (CLANKTON holders) |
|------------|------------|--------------------------------|
| < $250,000 | LOW | 2 per day |
| >= $250,000 | HIGH | 3 per day |

### Update Frequency

- **Option A**: Every 15 minutes (cron job)
- **Option B**: On-demand when bonus would change
- **Option C**: Event-driven from DEX trades (complex)

Recommendation: Start with Option A (cron) for simplicity.

## Implementation Tasks

1. [ ] Choose oracle data source
2. [ ] Implement market cap fetcher
3. [ ] Add market cap state to contract
4. [ ] Create cron job for updates
5. [ ] Update backend to read from contract (not env)
6. [ ] Add staleness checks
7. [ ] Test tier transitions
8. [ ] Deploy and verify

## Security Considerations

- **Manipulation Resistance**: Use TWAP, not spot price
- **Staleness**: Reject outdated market cap data
- **Access Control**: Only operator can push updates
- **Fallback**: If oracle fails, use last known value

## Timeline

- Milestone 6.2 is planned after 6.1 contract deployment
- Oracle implementation depends on CLANKTON liquidity on Base

## References

- CLANKTON Token: `0x461DEb53515CaC6c923EeD9Eb7eD5Be80F4e0b07`
- Aerodrome Docs: https://aerodrome.finance/docs
- Uniswap V3 Base: https://docs.uniswap.org/
