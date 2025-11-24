# Analytics Database Views

This directory contains SQL migration files for the analytics system.

## Overview

The analytics system uses materialized views to aggregate data from the `analytics_events` table. These views must be created manually in your Neon PostgreSQL database.

## Views Included

| View Name | Description | Columns |
|-----------|-------------|---------|
| `view_dau` | Daily Active Users | `day`, `active_users` |
| `view_wau` | Weekly Active Users | `week_start`, `active_users` |
| `view_free_paid_ratio` | Free vs Paid Guesses | `day`, `free_guesses`, `paid_guesses`, `free_to_paid_ratio` |
| `view_jackpot_growth` | Prize Pool Evolution | `day`, `round_id`, `jackpot_eth`, `winner_fid` |
| `view_referral_funnel` | Referral Metrics | `day`, `referral_shares`, `referral_joins`, `referral_wins`, `bonus_unlocked` |

## Setup Instructions

### Option 1: Using the Setup Script (Recommended)

```bash
# Make sure DATABASE_URL is set
export DATABASE_URL='postgresql://user:pass@host/database'

# Run the setup script
./scripts/setup-analytics-views.sh
```

### Option 2: Manual Setup

```bash
# Apply the SQL file directly
psql $DATABASE_URL < drizzle/0001_analytics_views.sql
```

### Option 3: Using Neon Console

1. Log into your [Neon Console](https://console.neon.tech/)
2. Navigate to your project
3. Open the SQL Editor
4. Copy and paste the contents of `0001_analytics_views.sql`
5. Execute the SQL

## Verification

After creating the views, verify they're working:

```sql
-- Check DAU data
SELECT * FROM view_dau LIMIT 5;

-- Check Free/Paid ratio
SELECT * FROM view_free_paid_ratio LIMIT 5;

-- List all views
SELECT table_name
FROM information_schema.views
WHERE table_name LIKE 'view_%';
```

## Troubleshooting

### Error: "relation 'analytics_events' does not exist"

Make sure you've run the main database migrations first:

```bash
npm run db:migrate
```

### Error: Views return no data

This is normal if you haven't logged any analytics events yet. The views will populate as users interact with the game and analytics events are logged.

To check if events are being logged:

```sql
SELECT COUNT(*) FROM analytics_events;
SELECT event_type, COUNT(*)
FROM analytics_events
GROUP BY event_type;
```

### Error: "permission denied for table analytics_events"

Make sure your database user has SELECT permissions on the `analytics_events` table.

## Updating Views

If you need to modify a view definition:

1. Edit `0001_analytics_views.sql`
2. Re-run the setup script or apply the SQL file manually
3. The `CREATE OR REPLACE VIEW` statements will update existing views

## Related Documentation

- Main README: See "Analytics System" section
- Game Documentation: See "Milestone 5.2: Analytics System"
- Admin Dashboard: `/admin/analytics`
