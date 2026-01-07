# Milestone 5.3 — Advanced Analytics & Fairness Systems

## Overview

Milestone 5.3 implements comprehensive game integrity protections, adversarial simulations, and provable-fairness monitoring. These systems ensure gameplay balance, economic sustainability, and protection against attacker vectors.

## Table of Contents

1. [Fairness Monitoring](#fairness-monitoring)
2. [Prize Audit System](#prize-audit-system)
3. [User Quality Gating](#user-quality-gating)
4. [Simulation Engine](#simulation-engine)
5. [Analytics Enhancements](#analytics-enhancements)
6. [Event Schema](#event-schema)
7. [API Reference](#api-reference)
8. [Admin UI](#admin-ui)
9. [Configuration](#configuration)

---

## Fairness Monitoring

### Location
`/src/services/fairness-monitor/index.ts`

### Purpose
Validates every commit-reveal pair across all rounds and detects mismatches between:
- Committed hash
- Revealed solution
- Jackpot payouts

### Key Functions

#### `validateRoundCommitment(roundId: number)`
Validates that `H(salt || answer) === commitHash` for a resolved round.

```typescript
const result = await validateRoundCommitment(123);
// Returns: FairnessValidationResult
// {
//   roundId: 123,
//   isValid: true,
//   commitHashValid: true,
//   payoutValid: true,
//   errors: [],
//   warnings: [],
//   checkedAt: Date
// }
```

#### `validateRoundPayouts(roundId: number)`
Validates that payout amounts follow expected economic rules:
- 80% to winner
- 10% to referrer (or seed+creator if no referrer)
- 10% to top guessers

#### `runFairnessAudit(options?)`
Runs a full audit across all resolved rounds.

```typescript
const report = await runFairnessAudit({
  startDate: new Date('2024-01-01'),
  endDate: new Date(),
});
// Returns: FairnessAuditReport
```

#### `detectSuspiciousSequences(lookbackRounds: number)`
Detects patterns that might indicate manipulation:
- Same answer appearing too frequently
- Same winner winning multiple times

#### `getRecentFairnessAlerts(limit: number)`
Retrieves recent fairness alerts from the analytics system.

### Automated Alerts
The system automatically logs alerts for:
- `FAIRNESS_ALERT_HASH_MISMATCH` - Critical: commit hash doesn't match
- `FAIRNESS_ALERT_PAYOUT_MISMATCH` - High: payout amounts incorrect
- `FAIRNESS_ALERT_SUSPICIOUS_SEQUENCE` - Medium: suspicious patterns detected

---

## Prize Audit System

### Location
`/src/services/fairness-monitor/prize-audit.ts`

### Purpose
Cross-checks prize amounts vs expected economic rules to detect underpayment, overpayment, or anomalies.

### Economic Rules
```typescript
const ECONOMIC_RULES = {
  GUESS_PRICE_ETH: 0.0003,      // Price per paid guess
  PRIZE_POOL_SHARE: 0.8,        // 80% to prize pool
  SEED_CREATOR_SHARE: 0.2,      // 20% to seed/creator
  WINNER_SHARE: 0.8,            // 80% of jackpot to winner
  REFERRER_SHARE: 0.1,          // 10% to referrer
  TOP_GUESSERS_SHARE: 0.1,      // 10% to top guessers
  SEED_CAP_ETH: 0.03,           // 0.03 ETH seed cap
};
```

### Key Functions

#### `auditPrizePoolGrowth(roundId: number)`
Audits prize pool growth based on paid guesses.

#### `runPrizeAudit(options?)`
Runs prize audit across multiple rounds.

#### `getPrizeAuditSummary()`
Returns summary statistics:
- Total jackpot distributed
- Total paid guesses
- Total revenue
- Average/largest jackpot

---

## User Quality Gating

### Location
`/src/lib/user-quality.ts`

### Purpose
Gates gameplay access based on Neynar's User Quality Score to reduce sybil/bot abuse.

### Eligibility Rule
**Only Farcaster users with `user_score >= 0.55` may submit guesses or purchase guess packs.**

Threshold lowered from 0.6 to 0.55 in January 2025 to expand player eligibility.

### Key Functions

#### `checkUserQuality(fid: number, forceRefresh?: boolean)`
Checks if a user is eligible to play.

```typescript
const result = await checkUserQuality(12345);
// Returns: UserQualityCheckResult
// {
//   eligible: true,
//   score: 0.75,
//   reason?: string,
//   errorCode?: string,
//   helpUrl?: string
// }
```

#### `logBlockedAttempt(fid, score, action)`
Logs a blocked gameplay attempt for analytics.

#### `batchRefreshUserScores(fids: number[])`
Batch refresh user scores (for cron job).

#### `getUserQualityStats()`
Returns quality statistics:
- Total users
- Users with scores
- Eligible/ineligible users
- Average score

### Score Caching
- Scores are cached in the database with a timestamp
- Cache duration: 24 hours
- Refresh periodically to avoid rate limits

### Error Handling
When a user is blocked:
```json
{
  "error": "INSUFFICIENT_USER_SCORE",
  "message": "Your Farcaster reputation score (0.45) is below the minimum required (0.55)...",
  "score": 0.45,
  "minRequired": 0.55,
  "helpUrl": "https://docs.neynar.com/docs/user-scores"
}
```

### Configuration
Enable user quality gating with:
```
USER_QUALITY_GATING_ENABLED=true
```

---

## Simulation Engine

### Location
`/src/services/simulation-engine/index.ts`

### Purpose
Provides adversarial and stress simulations to detect exploitation patterns.

### Available Simulations

#### 1. Wallet Clustering (`wallet_clustering`)
Detects users pretending to be multiple identities.

**Detection Methods:**
- Shared wallet addresses
- Referral chain patterns
- Similar creation times

**Output:**
```typescript
interface WalletClusterResult {
  clusters: WalletCluster[];
  totalUsersAnalyzed: number;
  suspiciousUserCount: number;
  clusterRiskScore: number;
}
```

#### 2. Rapid-Fire / Repeat-Winner (`rapid_winner`)
Models improbable win streaks.

**Detection Methods:**
- Win frequency analysis
- Timing pattern analysis
- Statistical probability scoring

**Output:**
```typescript
interface RapidWinnerResult {
  suspiciousWinners: SuspiciousWinner[];
  totalWinnersAnalyzed: number;
  statisticalAnomaly: boolean;
}
```

#### 3. Front-Run Risk Assessment (`frontrun_risk`)
Ensures reveal cannot be guessed pre-commit.

**Assessed Attack Vectors:**
- Commit hash pre-image attack
- Timing-based guess submission
- Database access attack
- Server-side information leak
- Referrer collusion

**Output:**
```typescript
interface FrontRunRiskResult {
  attackVectors: AttackVector[];
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
}
```

#### 4. Jackpot Runway (`jackpot_runway`)
Models jackpot growth/decay under various economic scenarios.

**Scenarios:**
- Optimistic (2x guesses)
- Baseline (normal activity)
- Pessimistic (0.5x guesses)
- Stress (0.1x guesses)

**Output:**
```typescript
interface RunwayResult {
  currentJackpot: number;
  projectedRounds: RunwayProjection[];
  sustainabilityScore: number;
  daysToDepletion: number | null;
  scenarioResults: EconomicScenario[];
}
```

#### 5. Full Suite (`full_suite`)
Runs all simulations and returns a combined report.

### Running Simulations

Via API:
```bash
curl -X POST /api/admin/analytics/simulations \
  -H "Content-Type: application/json" \
  -d '{"type": "wallet_clustering"}'
```

Via Code:
```typescript
import { runFullSimulationSuite } from './src/services/simulation-engine';
const results = await runFullSimulationSuite();
```

---

## Analytics Enhancements

### New Endpoints

#### Performance Metrics (`/api/admin/analytics/performance`)
- Median guesses to solve
- Mean guesses to solve
- Guess distribution histogram (buckets)
- CLANKTON holder solve-rate advantage
- Referral-generated guesses
- User quality metrics

#### Fairness Analytics (`/api/admin/analytics/fairness`)
- Recent alerts
- Prize audit summary
- Overall fairness status

#### Simulations (`/api/admin/analytics/simulations`)
- Run adversarial simulations
- View results

#### Data Export (`/api/admin/analytics/export`)
- CSV export
- JSON export
- Supports: rounds, guesses, users, payouts, analytics_events

### CLANKTON Holder Advantage
```typescript
interface ClanktonAdvantage {
  clanktonSolveRate: number;
  regularSolveRate: number;
  clanktonAvgGuesses: number;
  regularAvgGuesses: number;
  advantagePercentage: number;
  clanktonWinRate: number;
  regularWinRate: number;
}
```

---

## Event Schema

### New Event Types

#### Fairness Events
```typescript
FAIRNESS_ALERT: 'fairness_alert'
FAIRNESS_ALERT_HASH_MISMATCH: 'FAIRNESS_ALERT_HASH_MISMATCH'
FAIRNESS_ALERT_PAYOUT_MISMATCH: 'FAIRNESS_ALERT_PAYOUT_MISMATCH'
FAIRNESS_ALERT_SUSPICIOUS_SEQUENCE: 'FAIRNESS_ALERT_SUSPICIOUS_SEQUENCE'
FAIRNESS_ALERT_INVALID_HASH_CHAIN: 'FAIRNESS_ALERT_INVALID_HASH_CHAIN'
PRIZE_AUDIT_MISMATCH: 'PRIZE_AUDIT_MISMATCH'
FAIRNESS_AUDIT_COMPLETED: 'FAIRNESS_AUDIT_COMPLETED'
```

#### Simulation Events
```typescript
SIM_STARTED: 'SIM_STARTED'
SIM_COMPLETED: 'SIM_COMPLETED'
SIM_RESULT: 'SIM_RESULT'
CLUSTER_ALERT: 'CLUSTER_ALERT'
RAPID_FIRE_ALERT: 'RAPID_FIRE_ALERT'
FRONTRUN_RISK: 'FRONTRUN_RISK'
RUNWAY_WARNING: 'RUNWAY_WARNING'
```

#### User Quality Events
```typescript
USER_QUALITY_BLOCKED: 'USER_QUALITY_BLOCKED'
USER_QUALITY_REFRESHED: 'USER_QUALITY_REFRESHED'
```

---

## API Reference

### GET /api/admin/analytics/fairness
Returns fairness dashboard data.

**Response:**
```json
{
  "recentAlerts": [],
  "prizeAuditSummary": {
    "totalJackpotDistributed": 1.5,
    "totalPaidGuesses": 5000,
    "totalRevenue": 1.5,
    "averageJackpot": 0.05,
    "largestJackpot": 0.25
  },
  "fairnessStatus": "healthy"
}
```

### POST /api/admin/analytics/fairness
Run fairness audits.

**Request:**
```json
{ "action": "audit" }
// or
{ "action": "validate_round", "roundId": 123 }
// or
{ "action": "prize_audit" }
```

### POST /api/admin/analytics/simulations
Run simulations.

**Request:**
```json
{
  "type": "wallet_clustering" | "rapid_winner" | "frontrun_risk" | "jackpot_runway" | "full_suite",
  "options": {
    "lookbackRounds": 100,
    "minWinsToFlag": 3
  }
}
```

### GET /api/admin/analytics/performance
Returns performance metrics with CLANKTON advantage and referral metrics.

### POST /api/admin/analytics/export
Export data in CSV or JSON format.

**Request:**
```json
{
  "dataType": "rounds" | "guesses" | "users" | "payouts" | "analytics_events",
  "format": "csv" | "json",
  "limit": 1000
}
```

---

## Admin UI

### Location
`/pages/admin/analytics.tsx`

### New Sections

1. **Fairness & Integrity**
   - Fairness status indicator
   - Recent alerts count
   - Prize audit summary
   - Alerts list

2. **User Quality Gating**
   - Average user score
   - Eligible/blocked users count
   - Blocked attempts count

3. **Referral Performance**
   - Total referrals
   - Referral-generated guesses
   - Referral wins and payouts
   - Top referrers table

4. **Adversarial Simulations**
   - Simulation control buttons
   - Real-time results display
   - Status indicators

5. **Guess Distribution Histogram**
   - Bucketed visualization (1-5, 6-10, etc.)

---

## Configuration

### Environment Variables

```bash
# Enable user quality gating
USER_QUALITY_GATING_ENABLED=true

# Enable analytics (required for all features)
ANALYTICS_ENABLED=true

# Neynar API key (required for user score fetching)
NEYNAR_API_KEY=your_api_key
```

### Database Migration

Run the migration for user quality score fields:
```sql
-- File: /drizzle/0002_user_quality_score.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_score DECIMAL(5, 3);
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_score_updated_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS users_user_score_updated_at_idx ON users(user_score_updated_at);
```

---

## Future Enhancements

1. **Cron Job for Fairness Audit**
   - Run fairness-audit worker every 5 minutes
   - Send webhook alerts on issues

2. **Custom Time Ranges**
   - Support custom date ranges for all analytics

3. **Webhook Notifications**
   - Send alerts to Discord/Slack

4. **Enhanced Clustering Detection**
   - IP-based clustering
   - Behavioral pattern analysis
