# Database Migrations Guide

## Running Migrations on Vercel

### Option 1: Manual Migration via Terminal (Recommended)

The safest way to run migrations on your Vercel production database:

1. **Set up your local environment:**
   ```bash
   # Copy your Vercel DATABASE_URL to .env
   # You can find this in Vercel Dashboard > Settings > Environment Variables
   DATABASE_URL=postgresql://your-production-database-url
   ```

2. **Run migrations locally against production database:**
   ```bash
   npm run db:migrate
   ```

3. **Verify the migration:**
   ```bash
   # Check that all tables exist
   npm run validate
   ```

### Option 2: Using Vercel CLI

```bash
# Install Vercel CLI if you haven't
npm i -g vercel

# Pull environment variables from Vercel
vercel env pull .env.local

# Run migrations using production DATABASE_URL
npm run db:migrate

# Or run directly on Vercel (requires build)
vercel env pull
npm run db:migrate
```

### Option 3: Add Migration to Build Process

**⚠️ Not recommended for production** - This runs migrations automatically on every deploy, which can cause issues with concurrent deploys.

Add to `package.json`:
```json
{
  "scripts": {
    "build": "npm run db:migrate && next build"
  }
}
```

## Current Migration Status

The generated migration `drizzle/0000_thankful_smasher.sql` includes:

- ✅ All 8 tables with correct schema
- ✅ `username` column in users table (fixes "column does not exist" error)
- ✅ All indexes and foreign keys
- ✅ `hasSeenIntro` column for first-time user overlay

## Troubleshooting

### Error: "column 'username' does not exist"

**Cause:** Production database hasn't been migrated yet.

**Solution:** Run migrations using Option 1 or 2 above.

### Error: "relation already exists"

**Cause:** Tables already exist in the database.

**Solution:** The migration uses `CREATE TABLE IF NOT EXISTS`, so this shouldn't happen. If it does, you may have an older schema version. Check existing tables:

```bash
# Connect to your database and check
psql $DATABASE_URL -c "\dt"
```

### Error: "NEYNAR_API_KEY not configured"

**Cause:** This is a separate issue from migrations.

**Solution:** Add `NEYNAR_API_KEY` to Vercel environment variables, or the app will work in dev mode without it.

## Migration Commands Reference

```bash
# Generate new migrations from schema changes
npm run db:generate

# Run pending migrations
npm run db:migrate

# Open Drizzle Studio (database GUI)
npm run db:studio

# Validate database setup
npm run validate
```

## After Running Migrations

Once migrations are complete, redeploy your app to Vercel:

```bash
git push origin main
```

Or trigger a manual redeploy in Vercel Dashboard.

The "Failed to fetch user state" error should be resolved once the `username` column exists in the database.
