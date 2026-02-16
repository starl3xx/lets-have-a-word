# Milestone 6.2 - $WORD Market Cap Oracle Integration

## Overview

This milestone implements a live oracle for $WORD token market cap, replacing the environment variable configuration. The oracle feeds market cap data to the JackpotManager contract to enable automatic bonus tier adjustments.

## Implementation Status

| Task | Status |
|------|--------|
| Contract Updates | ✅ Complete |
| Upgrade Script | ✅ Complete |
| Tests | ✅ Complete (40 passing) |
| Backend Oracle Service | ✅ Complete |
| Integration with word-token.ts | ✅ Complete |
| Documentation | ✅ Complete |

## Contract Changes

### New State Variables

```solidity
/// @notice $WORD market cap in USD (8 decimals precision, contract variable name unchanged — deployed onchain)
uint256 public clanktonMarketCapUsd;

/// @notice Timestamp of last market cap update
uint256 public lastMarketCapUpdate;
```

### New Constants

```solidity
/// @notice Market cap threshold for HIGH bonus tier ($250,000 with 8 decimals)
uint256 public constant MARKET_CAP_TIER_THRESHOLD = 250_000 * 1e8;

/// @notice Maximum age for market cap data before considered stale (1 hour)
uint256 public constant MARKET_CAP_STALENESS_THRESHOLD = 1 hours;
```

### New Enum

```solidity
enum BonusTier {
    LOW,  // 2 free guesses per day for $WORD holders
    HIGH  // 3 free guesses per day for $WORD holders
}
```

### New Functions

| Function | Access | Description |
|----------|--------|-------------|
| `updateClanktonMarketCap(uint256)` | Operator | Update $WORD market cap from oracle (contract function name unchanged — deployed onchain) |
| `getCurrentBonusTier()` | View | Get current tier (LOW/HIGH) |
| `getFreeGuessesForTier()` | View | Get free guesses count (2/3) |
| `isMarketCapStale()` | View | Check if data is stale (>1 hour) |
| `getMarketCapInfo()` | View | Get full market cap info |

### New Event

```solidity
event MarketCapUpdated(uint256 marketCapUsd, uint256 timestamp);
```

## Bonus Tier Logic

| Market Cap | Tier | Free Guesses ($WORD holders) |
|------------|------|--------------------------------|
| < $250,000 | LOW | 2 per day |
| >= $250,000 | HIGH | 3 per day |

## Backend Integration

### Oracle Service (`src/lib/word-oracle.ts`)

```typescript
// Fetch market cap from available sources (DexScreener, CoinGecko)
const marketCap = await fetchWordMarketCap();

// Push to contract
await pushMarketCapToContract();

// Get current state from contract
const info = await getContractMarketCapInfo();
const tier = await getCurrentBonusTierFromContract();
const guesses = await getFreeGuessesFromContract();
```

### Data Sources (Priority Order)

1. **DexScreener** (Primary)
   - Endpoint: `https://api.dexscreener.com/latest/dex/tokens/{address}`
   - Uses FDV (Fully Diluted Valuation) as market cap proxy
   - Best for new/low-cap tokens

2. **CoinGecko** (Fallback)
   - Endpoint: `https://api.coingecko.com/api/v3/coins/base/contract/{address}`
   - Rate limited on free tier
   - Requires token to be listed

### $WORD Integration (`src/lib/word-token.ts`)

```typescript
// Get free guesses from contract (with env fallback)
const guesses = await getWordFreeGuesses();

// Get bonus tier from contract (with env fallback)
const tier = await getWordBonusTier();
```

## Upgrade Process

### Deploy Upgrade

```bash
cd contracts
npx hardhat run scripts/upgrade.ts --network base
```

The upgrade script will:
1. Validate upgrade compatibility
2. Deploy new implementation
3. Verify new functions work
4. Output new implementation address

### Verify New Implementation

```bash
npx hardhat verify --network base <NEW_IMPLEMENTATION_ADDRESS>
```

## Cron Setup

Update market cap every 15 minutes:

```typescript
import cron from 'node-cron';
import { runOracleUpdate } from './lib/word-oracle';

// Every 15 minutes
cron.schedule('*/15 * * * *', runOracleUpdate);
```

Alternative using system cron:
```bash
*/15 * * * * cd /app && node -e "require('./lib/word-oracle').runOracleUpdate()"
```

## Test Results

```
JackpotManager
  ...existing tests (27 passing)...
  Market Cap Oracle (Milestone 6.2)
    ✔ should allow operator to update market cap
    ✔ should emit MarketCapUpdated event
    ✔ should revert if non-operator tries to update market cap
    ✔ should return LOW tier when market cap is below threshold
    ✔ should return HIGH tier when market cap meets threshold
    ✔ should return HIGH tier when market cap exceeds threshold
    ✔ should return 2 free guesses for LOW tier
    ✔ should return 3 free guesses for HIGH tier
    ✔ should report stale when never updated
    ✔ should not be stale immediately after update
    ✔ should return complete market cap info
    ✔ should have correct threshold constant
    ✔ should have correct staleness threshold (1 hour)

40 passing
```

## Security Considerations

- **Access Control**: Only operator can push market cap updates
- **Staleness Checks**: Data older than 1 hour is flagged as stale
- **Fallback**: If contract call fails, backend falls back to env variable
- **No Spot Price**: Uses market cap, not spot price (less manipulable)

## File Changes

| File | Change |
|------|--------|
| `contracts/src/JackpotManager.sol` | Added oracle state and functions |
| `contracts/scripts/upgrade.ts` | New upgrade script |
| `contracts/test/JackpotManager.test.ts` | Added 13 new tests |
| `src/lib/word-oracle.ts` | New oracle service |
| `src/lib/word-token.ts` | Added contract integration |
| `src/lib/jackpot-contract.ts` | Extended ABI |

## Environment Variables

No new environment variables required. The oracle fetches data from public APIs and the contract handles all state.

Optional for fallback:
```bash
# Fallback market cap if contract unavailable
WORD_MARKET_CAP_USD=150000
```

## References

- $WORD Token: `0x461DEb53515CaC6c923EeD9Eb7eD5Be80F4e0b07`
- JackpotManager Proxy: `0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5`
- DexScreener API: https://docs.dexscreener.com/
- CoinGecko API: https://www.coingecko.com/api/documentation

---

*Implemented: 2025-11-25*
*Milestone: 6.2 - $WORD Market Cap Oracle Integration*
