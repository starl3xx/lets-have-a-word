# Testing Guide

## Running Tests

The user management tests are **integration tests** that require a live database connection.

### Prerequisites

1. Set up your `.env` file with `DATABASE_URL`
2. Run database migrations: `npm run db:migrate`

### Run Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test src/lib/users.test.ts

# Run tests in watch mode
npm test -- --watch
```

### Test Coverage

**User Management Tests** (`src/lib/users.test.ts`):
- ✅ New user creation with FID and signer wallet
- ✅ Referrer attribution on first creation only
- ✅ Self-referral rejection
- ✅ Wallet and spam score updates
- ✅ Referrer preservation (not overwritten)
- ✅ Null handling for wallet/spam score
- ✅ User lookup by FID

## Development Mode Testing

For local testing without Neynar API key, the `/api/guess` endpoint accepts `devFid`:

```bash
curl -X POST http://localhost:3000/api/guess \
  -H "Content-Type: application/json" \
  -d '{"word": "BRAIN", "devFid": 12345}'
```

## Validation Script

The comprehensive validation script tests the entire game flow:

```bash
npm run validate
```

This validates:
- Word lists
- Game rules
- Round lifecycle
- Guess submission
- Commit-reveal cryptography
- All game logic end-to-end
