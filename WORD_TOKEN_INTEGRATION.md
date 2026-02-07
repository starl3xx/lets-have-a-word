# $WORD Token Integration

## Overview

This implements $WORD token integration into the Let's Have A Word game economy, following the successful CLANKTON token integration pattern.

## Features Implemented

### 1. Token Balance Checking
- **Contract:** Placeholder address (needs deployment)
- **Threshold:** 1,000,000 $WORD tokens (lower than CLANKTON's 100M threshold)
- **Network:** Base mainnet via ethers.js

### 2. Daily Bonus System
- **Bonus Amount:** +1 additional guess per day for $WORD token holders
- **Consumption Order:** Base → CLANKTON → $WORD → Share → Paid
- **Allocation:** Checked daily during state creation
- **Late Allocation:** Supports wallet connection after daily state creation

### 3. XP Integration
- **Event Type:** `WORD_TOKEN_BONUS_DAY`
- **XP Amount:** +5 XP per day (half of CLANKTON's +10 XP)
- **Frequency:** Once per day per holder
- **Tracking:** Prevents double awards within same day

### 4. Database Schema
- **New Field:** `free_allocated_word_token` in `daily_guess_state` table
- **Migration:** `0017_word_token_allocation.sql`
- **Type Safety:** Updated TypeScript interfaces

### 5. Economy Configuration
- **Config File:** `config/economy.ts`
- **Threshold:** `WORD_TOKEN_HOLDER_THRESHOLD = 1_000_000`
- **Bonus:** `WORD_TOKEN_BONUS_GUESSES = 1`

## Files Modified

### Core Implementation
- `src/lib/word-token.ts` - Main token integration (NEW)
- `src/lib/daily-limits.ts` - Daily allocation system
- `src/lib/xp.ts` - XP bonus awards
- `src/db/schema.ts` - Database schema
- `src/types/index.ts` - TypeScript interfaces
- `config/economy.ts` - Economy configuration

### Database Migration
- `migrations/0017_word_token_allocation.sql` - Schema migration (NEW)

### Documentation
- `WORD_TOKEN_INTEGRATION.md` - This file (NEW)

## Configuration

### Environment Variables (Optional)
None required initially - uses hardcoded contract address placeholder.

### Contract Address
Currently set to placeholder `0x0000000000000000000000000000000000000000`.
Update `WORD_TOKEN_ADDRESS` in `src/lib/word-token.ts` when deployed.

## Usage

### For Developers
```typescript
import { hasWordTokenBonus, getWordTokenBonusInfo } from '../lib/word-token';

// Check if user has bonus
const hasBonus = await hasWordTokenBonus(walletAddress);

// Get bonus info for UI
const bonusInfo = getWordTokenBonusInfo();
```

### For Users
1. Hold ≥1M $WORD tokens in connected wallet
2. Play game as normal - bonus applied automatically
3. Receive +1 additional guess per day
4. Earn +5 XP daily bonus (once per day)

## Testing

### Before Deployment
1. Update contract address in `word-token.ts`
2. Run migration: `npm run db:migrate`
3. Test with real token holders
4. Verify daily limits UI shows $WORD bonus
5. Confirm XP awards correctly

### Development Mode
- Placeholder contract address returns no bonus (safe)
- All logic paths tested with existing patterns
- Database schema backwards compatible

## Integration Points

### Daily Limits System
- Adds `wordToken` section to `GuessSourceState` interface
- Consumption order: Base → CLANKTON → **$WORD** → Share → Paid
- Late allocation support (wallet connected mid-day)

### XP System
- New event type: `WORD_TOKEN_BONUS_DAY`
- Award timing: First guess submission each day
- Prevents duplicate awards with date-based tracking

### UI Integration (TODO)
- Update guess bar to show $WORD bonus
- Add $WORD holder badge/indicator
- Display token balance in wallet section
- Show bonus info in help/FAQ

## Deployment Checklist

- [ ] Deploy $WORD token contract
- [ ] Update `WORD_TOKEN_ADDRESS` in code
- [ ] Run database migration in production
- [ ] Update UI to show $WORD bonus
- [ ] Test with real token holders
- [ ] Monitor bonus allocation logs
- [ ] Verify XP awards work correctly

## Comparison with CLANKTON

| Feature | CLANKTON | $WORD |
|---------|----------|-------|
| Threshold | 100M tokens | 1M tokens |
| Daily Bonus | 2-3 guesses (market cap based) | 1 guess (flat rate) |
| XP Bonus | +10 XP/day | +5 XP/day |
| Complexity | Dynamic tiers via oracle | Simple flat bonus |
| Target | Whales/large holders | Broader participation |

## Future Enhancements

1. **Tiered Bonuses:** Add multiple tiers based on holdings
2. **Market Cap Integration:** Dynamic bonuses like CLANKTON
3. **Special Events:** $WORD holder exclusive rounds
4. **NFT Integration:** Bonus multipliers for NFT + token combos
5. **Governance:** $WORD holder voting on game parameters