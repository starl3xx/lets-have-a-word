# Setup Guide - Milestone 1.1

This guide will help you set up **Let's Have A Word** Milestone 1.1 from scratch.

## Prerequisites

Make sure you have the following installed:
- **Node.js** v18 or higher
- **PostgreSQL** v14 or higher
- **npm** or **yarn**

## Step 1: Clone and Install

```bash
# Navigate to the project directory
cd lets-have-a-word

# Install dependencies
npm install
```

## Step 2: Configure Environment

```bash
# Copy the example environment file
cp .env.example .env
```

Edit `.env` and set your PostgreSQL connection string:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/lets_have_a_word
NODE_ENV=development
```

**Example:**
```env
DATABASE_URL=postgresql://postgres:mypassword@localhost:5432/lets_have_a_word
NODE_ENV=development
```

## Step 3: Create Database

Create the PostgreSQL database (if it doesn't exist):

```bash
# Using psql
psql -U postgres -c "CREATE DATABASE lets_have_a_word;"

# Or using createdb
createdb lets_have_a_word
```

## Step 4: Generate and Run Migrations

```bash
# Generate migration files from schema
npm run db:generate

# Run migrations to create tables
npm run db:migrate
```

This will create the following tables:
- `game_rules` - Game configuration rulesets
- `users` - Player accounts
- `rounds` - Game rounds
- `guesses` - Player guesses

## Step 5: Seed Default Data

```bash
# Seed the database with default game rules
npm run seed
```

This will:
1. Validate word list constraints
2. Insert the default "v1" game ruleset
3. Confirm successful setup

## Step 6: Validate Setup

```bash
# Run validation script
npm run validate
```

This will:
1. Validate word lists (ANSWER_WORDS, GUESS_WORDS, SEED_WORDS)
2. Verify game rules exist in database
3. Test round creation with commit-reveal
4. Verify commitment integrity

If everything passes, you should see:
```
🎉 All validation checks passed!

Milestone 1.1 setup is complete and working correctly.
```

## Step 7: Run Tests (Optional)

```bash
# Run unit tests
npm run test
```

Tests cover:
- Word list validation
- Commit-reveal cryptography
- Database schema integrity

## Step 8: Explore Database (Optional)

```bash
# Open Drizzle Studio (database GUI)
npm run db:studio
```

This opens a web interface at `https://local.drizzle.studio` where you can:
- View all tables
- Browse data
- Execute queries
- Inspect schema

## Development Workflow

### Build TypeScript

```bash
npm run build
```

Compiles TypeScript to JavaScript in the `dist/` folder.

### Development Mode

```bash
npm run dev
```

Runs the app with hot-reload using `tsx`.

### View Logs

The validation script and seed script will output detailed logs:
- ✅ Success messages (green checkmarks)
- ❌ Error messages (red X marks)
- ⚠️ Warning messages (yellow alerts)

## Troubleshooting

### Database Connection Error

**Error:** `Error: connect ECONNREFUSED`

**Solution:**
1. Make sure PostgreSQL is running
2. Verify `DATABASE_URL` in `.env` is correct
3. Check database exists: `psql -U postgres -l`

### Migration Error

**Error:** `relation "game_rules" already exists`

**Solution:**
This means migrations were already run. You can:
1. Drop and recreate database (destructive):
   ```bash
   psql -U postgres -c "DROP DATABASE lets_have_a_word;"
   psql -U postgres -c "CREATE DATABASE lets_have_a_word;"
   npm run db:migrate
   ```

### Word List Validation Error

**Error:** `CONSTRAINT VIOLATION: X seed words are in ANSWER_WORDS`

**Solution:**
This should not happen with the provided word lists. If you've modified the lists:
1. Check `src/data/answer-words.ts`
2. Check `src/data/seed-words.ts`
3. Ensure no overlap between ANSWER_WORDS and SEED_WORDS

### Import Errors

**Error:** `Cannot find module`

**Solution:**
1. Ensure you've run `npm install`
2. Make sure `"type": "module"` is in `package.json`
3. Rebuild: `npm run build`

## Next Steps

With Milestone 1.1 complete, you can:

1. **Inspect the data model**
   ```typescript
   import { getCurrentRules, createRound } from './src';

   const rules = await getCurrentRules();
   const round = await createRound();
   ```

2. **View database schema**
   ```bash
   npm run db:studio
   ```

3. **Run tests**
   ```bash
   npm run test
   ```

4. **Prepare for Milestone 1.2**
   - Farcaster integration
   - Neynar API setup
   - User authentication

## File Structure

```
lets-have-a-word/
├── src/
│   ├── data/              # Word lists
│   ├── db/                # Database schema
│   ├── lib/               # Core logic
│   ├── scripts/           # Setup scripts
│   ├── types/             # TypeScript types
│   └── __tests__/         # Unit tests
├── drizzle/               # Generated migrations (auto)
├── .env                   # Environment config (create this)
├── .env.example           # Environment template
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
├── drizzle.config.ts      # Drizzle ORM config
├── vitest.config.ts       # Test config
├── README.md              # Project overview
└── SETUP.md               # This file
```

## Support

If you encounter issues:
1. Check this guide thoroughly
2. Review error messages carefully
3. Verify all prerequisites are met
4. Check PostgreSQL is running and accessible

## Summary Checklist

- [ ] Node.js 18+ installed
- [ ] PostgreSQL 14+ installed
- [ ] Dependencies installed (`npm install`)
- [ ] `.env` file configured
- [ ] Database created
- [ ] Migrations run (`npm run db:migrate`)
- [ ] Data seeded (`npm run seed`)
- [ ] Validation passed (`npm run validate`)
- [ ] Tests passing (`npm run test`)

Once all items are checked, Milestone 1.1 is complete! 🎉
