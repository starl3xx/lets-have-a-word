# Rate Limiting QA Guide

## Overview

Milestone 9.6 adds lightweight, safety-first rate limiting that is effectively invisible to normal players. This document explains how to manually test the rate limiting behavior.

## Design Principles

- **High thresholds**: Regular users should never hit limits during normal play
- **Fail open**: If Redis is unavailable, requests are allowed through
- **Non-punitive**: Blocked requests show calm, brief messages
- **No credit loss**: Rate limiting never consumes guess credits

## Default Thresholds

| Endpoint | Burst Limit | Sustained Limit |
|----------|-------------|-----------------|
| `/api/guess` | 8 per 10s | 30 per 60s |
| `/api/share-callback` | 6 per 60s | - |
| `/api/purchase-guess-pack` | 4 per 5min | - |

Duplicate guess detection: Same FID + same word within 10 seconds

## Environment Variables for Testing

To lower thresholds for manual testing, set these environment variables:

```bash
# Guess endpoint
RATE_LIMIT_GUESS_BURST_REQUESTS=3
RATE_LIMIT_GUESS_BURST_WINDOW=5
RATE_LIMIT_GUESS_SUSTAINED_REQUESTS=5
RATE_LIMIT_GUESS_SUSTAINED_WINDOW=30

# Share callback
RATE_LIMIT_SHARE_REQUESTS=2
RATE_LIMIT_SHARE_WINDOW=30

# Purchase
RATE_LIMIT_PURCHASE_REQUESTS=2
RATE_LIMIT_PURCHASE_WINDOW=60

# Duplicate detection
RATE_LIMIT_DUPLICATE_WINDOW=5
```

## Manual Test Cases

### Test 1: Guess Rate Limiting

**Setup**: Set `RATE_LIMIT_GUESS_BURST_REQUESTS=3` and `RATE_LIMIT_GUESS_BURST_WINDOW=10`

**Steps**:
1. Submit a valid guess
2. Immediately submit 2 more different guesses
3. Try to submit a 4th guess within 10 seconds

**Expected**:
- First 3 guesses: Process normally
- 4th guess: Shows warning "Too fast — try again in a moment"
- No credits lost
- After ~10 seconds, guessing resumes normally

### Test 2: Duplicate Guess Detection

**Setup**: Default settings or set `RATE_LIMIT_DUPLICATE_WINDOW=10`

**Steps**:
1. Submit "CRANE" as a guess
2. Immediately submit "CRANE" again (same word)

**Expected**:
- First submission: Processes normally (incorrect or correct)
- Second submission: Silently absorbed, no banner shown
- No credits deducted for duplicate

### Test 3: Share Callback Idempotency

**Steps**:
1. Share your guess on Farcaster
2. Note the share bonus is awarded (+1 free guess)
3. Share again (or trigger share-callback again)

**Expected**:
- First share: Awards bonus, shows success message
- Second share: Returns `ok: true` with message "Share bonus already claimed today"
- No error shown to user
- No double-awarding of bonus

### Test 4: Purchase Rate Limiting

**Setup**: Set `RATE_LIMIT_PURCHASE_REQUESTS=2` and `RATE_LIMIT_PURCHASE_WINDOW=60`

**Steps**:
1. Purchase a guess pack
2. Immediately purchase another pack
3. Try to purchase a third pack within 60 seconds

**Expected**:
- First 2 purchases: Process normally
- 3rd purchase: Shows warning "Too many purchase requests — please wait a moment"
- No ETH charged for blocked request
- After ~60 seconds, purchasing resumes normally

### Test 5: Fail Open Behavior

**Setup**: Disable Redis (set invalid `UPSTASH_REDIS_REST_URL`)

**Steps**:
1. Submit multiple guesses rapidly
2. Try share callback multiple times

**Expected**:
- All requests process normally
- No rate limiting errors (Redis unavailable = fail open)
- Console shows: `[Redis] Not configured - caching disabled`

## Verification Checklist

- [ ] Normal gameplay feels identical before and after
- [ ] Regular users never hit limits during normal play (5+ guesses/minute is fine)
- [ ] Accidental retries are safely absorbed (duplicate detection)
- [ ] Share replays return success without double-awarding
- [ ] Rate limit messages are calm and non-accusatory
- [ ] No modal interruptions for rate limiting
- [ ] Credits are never lost due to rate limiting
- [ ] `Retry-After` header is set on 429 responses

## Analytics Events

Rate limiting logs these events for post-launch validation:

- `RATE_LIMITED_GUESS` - Guess endpoint rate limited
- `RATE_LIMITED_SHARE` - Share callback rate limited
- `RATE_LIMITED_PURCHASE` - Purchase endpoint rate limited
- `DUPLICATE_SUBMISSION_IGNORED` - Duplicate guess absorbed
- `SHARE_REPLAY_DETECTED` - Share callback replay detected

Check analytics to verify these events are rare in production.

## Troubleshooting

**"I'm hitting rate limits during normal play"**
- Check if you're using dev mode with lowered thresholds
- Verify Redis is configured and healthy
- Check for stuck network requests causing retries

**"Rate limiting isn't working at all"**
- Verify Redis is configured: Check for `[Redis] Client initialized` in logs
- Check environment variables are being read correctly
- Verify FID is being passed in requests

**"Duplicate detection isn't catching duplicates"**
- Ensure same FID and exact same word (case-insensitive)
- Check if window has elapsed (default 10 seconds)
- Verify Redis is available for duplicate tracking
