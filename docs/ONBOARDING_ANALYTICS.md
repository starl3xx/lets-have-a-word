# Onboarding Analytics - Post-Launch Validation Plan

## Overview

This document outlines the analytics instrumentation for the onboarding flow and the conversion questions these events will help answer after launch.

## Flow Changes (Milestone 7.x)

The onboarding flow has been reordered to show educational content before the add-app prompt:

**New Flow:**
1. "How the game works" tutorial (educational)
2. "Add to Farcaster" prompt (activation)
3. Enter main game

**Previous Flow:**
1. "Add to Farcaster" prompt (activation)
2. "How the game works" tutorial (educational)
3. Enter main game

**Hypothesis:** Users who understand the game mechanics first will be more likely to add the app because they see its value.

---

## Analytics Events

### Event Definitions

| Event Name | When Fired | Data Properties |
|------------|------------|-----------------|
| `onboarding_how_it_works_viewed` | Tutorial phase is displayed | `tutorialOnly: boolean` |
| `onboarding_how_it_works_completed` | User clicks "I'm ready!" | - |
| `onboarding_add_app_viewed` | Add-app prompt is displayed | - |
| `onboarding_add_app_accepted` | User successfully adds app | `notificationsEnabled: boolean` |
| `onboarding_add_app_skipped` | User skips add-app prompt | `reason: 'user_skip' \| 'declined'` |
| `onboarding_flow_completed` | Entire onboarding finishes | `addAppAccepted: boolean`, `reason?: string` |

### Event Flow Diagram

```
First-Time User Opens App
         │
         ▼
┌────────────────────────┐
│ onboarding_how_it_works│
│       _viewed          │
└────────────────────────┘
         │
         │  User clicks "I'm ready!"
         ▼
┌────────────────────────┐
│ onboarding_how_it_works│
│      _completed        │
└────────────────────────┘
         │
         ├─────────────────────────────────────┐
         │  (tutorialOnly = false)             │ (tutorialOnly = true)
         ▼                                     ▼
┌────────────────────────┐            ┌────────────────────────┐
│ onboarding_add_app     │            │ onboarding_flow        │
│       _viewed          │            │      _completed        │
└────────────────────────┘            │ {addAppShown: false}   │
         │                            └────────────────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
 [Add]     [Skip]
    │         │
    ▼         ▼
┌────────┐ ┌────────────────┐
│accepted│ │    skipped     │
└────────┘ └────────────────┘
    │              │
    └──────┬───────┘
           ▼
┌────────────────────────┐
│ onboarding_flow        │
│      _completed        │
└────────────────────────┘
```

---

## Post-Launch Conversion Questions

### Primary Metrics

1. **Add Acceptance Rate**
   - Query: `COUNT(add_app_accepted) / COUNT(add_app_viewed)`
   - Goal: Measure what percentage of users who see the add prompt actually add the app
   - Baseline: Compare against industry benchmarks (~15-25% for app install prompts)

2. **Onboarding Completion Rate**
   - Query: `COUNT(flow_completed) / COUNT(how_it_works_viewed)`
   - Goal: Identify drop-off in the onboarding funnel
   - Target: >90% completion (minimal friction)

3. **Tutorial Impact on Add Rate**
   - Query: Compare `add_app_accepted` rate for users who completed tutorial vs baseline
   - Goal: Validate hypothesis that education improves add acceptance
   - Action: If no improvement, consider A/B testing flow order

### Secondary Metrics

4. **Skip Rate Analysis**
   - Query: `COUNT(add_app_skipped WHERE reason='user_skip') / COUNT(add_app_viewed)`
   - Goal: Understand if users actively skip vs decline system prompt
   - Insight: High user_skip suggests prompt fatigue; high declined suggests timing issue

5. **Notification Opt-in Rate**
   - Query: `COUNT(add_app_accepted WHERE notificationsEnabled=true) / COUNT(add_app_accepted)`
   - Goal: Track notification permission alongside app add
   - Action: If low, consider separate notification prompt timing

### Cohort Analysis (Future)

6. **Day-1 Return Rate by Onboarding Path**
   - Compare return rate: users who added app vs skipped
   - Hypothesis: Users who add app have higher D1 retention

7. **First Guess Conversion**
   - Query: `COUNT(users with first_guess_submitted) / COUNT(flow_completed)`
   - Goal: Measure onboarding → engagement conversion

8. **Tutorial Re-engagement**
   - Query: `COUNT(how_it_works_viewed WHERE tutorialOnly=true)`
   - Goal: Track how many users resurface tutorial via info icon
   - Insight: High re-engagement may indicate unclear initial tutorial

---

## SQL Query Templates

### Basic Funnel Analysis
```sql
-- Onboarding funnel breakdown
SELECT
  COUNT(CASE WHEN event_type = 'onboarding_how_it_works_viewed' THEN 1 END) as tutorial_viewed,
  COUNT(CASE WHEN event_type = 'onboarding_how_it_works_completed' THEN 1 END) as tutorial_completed,
  COUNT(CASE WHEN event_type = 'onboarding_add_app_viewed' THEN 1 END) as add_prompt_viewed,
  COUNT(CASE WHEN event_type = 'onboarding_add_app_accepted' THEN 1 END) as add_accepted,
  COUNT(CASE WHEN event_type = 'onboarding_add_app_skipped' THEN 1 END) as add_skipped,
  COUNT(CASE WHEN event_type = 'onboarding_flow_completed' THEN 1 END) as flow_completed
FROM analytics_events
WHERE created_at >= '2025-01-01';
```

### Add Rate Calculation
```sql
-- Add acceptance rate
SELECT
  ROUND(
    100.0 * COUNT(CASE WHEN event_type = 'onboarding_add_app_accepted' THEN 1 END) /
    NULLIF(COUNT(CASE WHEN event_type = 'onboarding_add_app_viewed' THEN 1 END), 0),
    2
  ) as add_acceptance_rate_pct
FROM analytics_events
WHERE created_at >= '2025-01-01';
```

### Daily Trend
```sql
-- Daily onboarding metrics
SELECT
  DATE(created_at) as date,
  COUNT(DISTINCT CASE WHEN event_type = 'onboarding_how_it_works_viewed' THEN user_id END) as new_users,
  COUNT(DISTINCT CASE WHEN event_type = 'onboarding_add_app_accepted' THEN user_id END) as users_added_app
FROM analytics_events
WHERE event_type LIKE 'onboarding_%'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

---

## Implementation Notes

- Analytics events are fire-and-forget (never block UI)
- Events are logged via `POST /api/analytics/log`
- All events include `userId` (FID) when available
- Events respect `ANALYTICS_ENABLED` environment variable
- Debug mode available via `ANALYTICS_DEBUG=true`

---

## Changelog

- **Milestone 7.x**: Initial implementation
  - Reversed onboarding flow (tutorial → add-app)
  - Added 6 analytics events for funnel tracking
  - Created this validation plan document
