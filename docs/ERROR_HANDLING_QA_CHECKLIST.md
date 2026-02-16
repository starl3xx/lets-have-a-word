# Error Handling QA Checklist

This document describes how to manually test each "bad but possible" state in the app.
Use dev mode (`NEXT_PUBLIC_LHAW_DEV_MODE=true`) for most scenarios.

---

## A. Network / Service Failures

### A1. /api/round-state fails
**How to test:**
1. In browser DevTools > Network, right-click `/api/round-state` and select "Block request URL"
2. Refresh the page

**Expected behavior:**
- Top ticker shows last known values or skeleton placeholders
- No crash or blank screen
- After retry, data loads normally

### A2. CoinGecko fails or rate-limits
**How to test:**
1. Block `api.coingecko.com` in DevTools Network
2. Refresh and observe prize pool display

**Expected behavior:**
- ETH value displays normally
- USD shows "~$X" (estimated from cache) or is omitted if no cache
- No "USD unavailable" text unless cache is completely empty
- `price_usd_unavailable` event logged (check console or analytics)

### A3. /api/user-state fails
**How to test:**
1. Block `/api/user-state` in DevTools
2. Try to submit a guess

**Expected behavior:**
- App defaults to showing guesses available (optimistic)
- If guess succeeds, state updates correctly
- No stuck loading state

### A4. /api/guess fails (network error)
**How to test:**
1. Submit a guess
2. Go offline (DevTools > Network > Offline) mid-request

**Expected behavior:**
- Error banner: "Guess not submitted"
- Retry button available
- Guess count NOT decremented (credit safety)
- Word remains in input for retry

### A5. Wallet RPC errors
**How to test:**
1. Block Base RPC endpoint in DevTools
2. Open Stats sheet and check $WORD section

**Expected behavior:**
- "Unable to verify token balance" message
- Retry option available
- App continues to function

---

## B. Game Lifecycle Mismatches

### B1. Round closes during guess submission
**How to test:**
1. In dev mode, submit a guess
2. Have another tab/window resolve the round (or simulate via admin)
3. Original guess returns `round_closed`

**Expected behavior:**
- Banner: "Round ended. Loading the new round..."
- Auto-refresh of round state
- User can play new round immediately
- `round_closed_on_guess` event logged

### B2. Stale round while idle
**How to test:**
1. Open app, note round ID
2. Wait or use admin to advance to next round
3. Interact with the app

**Expected behavior:**
- On next poll or interaction, stale round detected
- Banner shows "New round started"
- Auto-refresh or manual refresh button
- `round_stale_detected` event logged

### B3. Archive page failures
**How to test:**
1. Navigate to `/archive`
2. Block `/api/archive/*` endpoints

**Expected behavior:**
- Error message with retry button
- No crash or blank page

---

## C. User State / Eligibility Issues

### C1. User quality blocked
**How to test:**
1. Use a test FID with score < 0.6
2. Try to submit a guess

**Expected behavior:**
- Clear message: "Account verification needed"
- Link to learn more about Neynar score
- `USER_QUALITY_BLOCKED` event logged

### C2. Out of guesses
**How to test:**
1. Use all daily guesses (free + paid)
2. Try to guess again

**Expected behavior:**
- Message: "No guesses left today"
- CTA to share for bonus or buy packs
- Guess button disabled or shows appropriate state

### C3. Invalid word
**How to test:**
1. Submit "ZZZZZ" or "ABC"

**Expected behavior:**
- "Invalid word" or "Not in dictionary" message
- Guess count NOT decremented
- Can immediately try another word

### C4. Word already guessed
**How to test:**
1. Submit a valid word that was already guessed this round

**Expected behavior:**
- "Already guessed" message
- Guess count NOT decremented
- Can immediately try another word

### C5. Share in browser (not Warpcast)
**How to test:**
1. Open app in regular browser (not Warpcast frame)
2. Try to use share functionality

**Expected behavior:**
- Message: "Open in Warpcast"
- No crash
- `farcaster_context_missing` event logged if appropriate

---

## D. Payment / Pack Purchase Issues

### D1. Pricing endpoint fails
**How to test:**
1. Block `/api/round/pack-pricing`
2. Open purchase modal

**Expected behavior:**
- Error message with retry
- Cannot proceed with purchase until pricing loads

### D2. Purchase transaction rejected
**How to test:**
1. Start a pack purchase
2. Reject in wallet

**Expected behavior:**
- Message: "Transaction cancelled"
- No credits deducted
- Can retry immediately
- `purchase_tx_rejected` event logged

### D3. Max packs reached
**How to test:**
1. Purchase 3 packs in a day
2. Try to purchase another

**Expected behavior:**
- Message: "Daily limit reached"
- Clear indication of when limit resets (11:00 UTC)

---

## E. Credit Safety Verification

**Critical**: For all of the following scenarios, verify that guess credits are NOT decremented:

| Scenario | Expected Credit Change |
|----------|----------------------|
| Network error on guess | No change |
| Server 5xx error | No change |
| `invalid_word` response | No change |
| `already_guessed_word` response | No change |
| `round_closed` response | No change |
| Rate limited (429) | No change |
| Valid incorrect guess | -1 guess |
| Valid correct guess (win) | -1 guess |

---

## F. Recovery Actions

Each error should have a clear single action:

| Error Type | Expected Action |
|------------|-----------------|
| Network failure | "Retry" button |
| Round stale | Auto-refresh or "Refresh" button |
| Rate limited | "Wait" (disabled button briefly) |
| User quality blocked | "Learn more" link |
| Max packs reached | "Dismiss" |
| Share already claimed | "Dismiss" |

---

## G. Console Logging Verification

For each error scenario, verify structured logging:

```
[appErrors] {
  code: 'ERROR_CODE',
  roundId: 123,
  fid: 456,
  metadata: { ... }
}
```

Check that:
- No raw errors exposed in console
- Consistent `[prefix]` format
- Includes `roundId` and `fid` where applicable
- Sensitive data not logged

---

## H. Analytics Events

Verify these events fire in appropriate scenarios:

| Event | Trigger |
|-------|---------|
| `api_failure_round_state` | Round state fetch fails |
| `api_failure_user_state` | User state fetch fails |
| `api_failure_guess` | Guess submission fails |
| `price_usd_unavailable` | CoinGecko fails (rate-limited) |
| `round_stale_detected` | Round changed while idle |
| `round_stale_recovery_success` | Successfully loaded new round |
| `round_closed_on_guess` | Guess returned round_closed |
| `purchase_tx_rejected` | User rejected wallet tx |
| `share_bonus_failed` | Share callback failed |
| `USER_QUALITY_BLOCKED` | User blocked by quality gate |

---

## I. Visual Regression

Verify these UI states look correct:

1. Error banner (red) - doesn't shift layout
2. Warning banner (amber) - doesn't shift layout
3. Info banner (blue) - doesn't shift layout
4. Skeleton loading states - fixed width, no jumping
5. USD unavailable state - shows ETH only, clean layout
6. Stale round banner - clear messaging, prominent refresh CTA

---

## Quick Test Script

Run through these scenarios in sequence:

1. Fresh load - verify all states load
2. Block round-state, refresh - verify fallback
3. Submit invalid word - verify no credit loss
4. Go offline, submit guess - verify retry works
5. Unblock, submit valid guess - verify success
6. Check console for structured logging
7. Check analytics for events

---

## Files Changed

Core infrastructure added:
- `src/lib/appErrors.ts` - Error codes and display configs
- `src/lib/fetchWithRetry.ts` - Fetch with retry logic
- `src/lib/priceCache.ts` - USD price caching
- `src/lib/staleRoundDetector.ts` - Round change detection
- `components/ErrorBanner.tsx` - Error display component
- `src/lib/prices.ts` - Enhanced with analytics
- `src/lib/analytics.ts` - New error events
