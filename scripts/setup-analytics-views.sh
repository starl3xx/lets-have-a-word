#!/bin/bash
# Setup Analytics Views for "Let's Have A Word"
# This script creates the necessary database views for the analytics dashboard

set -e  # Exit on error

echo "========================================="
echo "Setting up Analytics Views"
echo "========================================="
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  echo ""
  echo "Please set DATABASE_URL to your Neon PostgreSQL connection string:"
  echo "export DATABASE_URL='postgresql://user:pass@host/database'"
  exit 1
fi

# Check if psql is available
if ! command -v psql &> /dev/null; then
  echo "❌ ERROR: psql command not found"
  echo ""
  echo "Please install PostgreSQL client tools:"
  echo "  - macOS: brew install postgresql"
  echo "  - Ubuntu/Debian: sudo apt-get install postgresql-client"
  echo "  - Windows: Install from https://www.postgresql.org/download/windows/"
  exit 1
fi

echo "✅ DATABASE_URL is set"
echo "✅ psql is available"
echo ""
echo "Creating analytics views..."
echo ""

# Apply the SQL file
psql "$DATABASE_URL" < drizzle/0001_analytics_views.sql

if [ $? -eq 0 ]; then
  echo ""
  echo "========================================="
  echo "✅ Analytics views created successfully!"
  echo "========================================="
  echo ""
  echo "The following views are now available:"
  echo "  - view_dau              (Daily Active Users)"
  echo "  - view_wau              (Weekly Active Users)"
  echo "  - view_free_paid_ratio  (Free/Paid Guess Breakdown)"
  echo "  - view_jackpot_growth   (Prize Pool Evolution)"
  echo "  - view_referral_funnel  (Referral Metrics)"
  echo ""
  echo "You can now access the admin analytics dashboard at:"
  echo "  /admin/analytics"
  echo ""
else
  echo ""
  echo "❌ ERROR: Failed to create analytics views"
  echo "Please check the error messages above"
  exit 1
fi
