/**
 * CLANKTON Market Cap Oracle Cron Job
 * Milestone 6.2 - Oracle Integration
 *
 * This script fetches CLANKTON market cap and pushes to the JackpotManager contract.
 * Run every 15 minutes via cron or scheduler.
 *
 * Usage:
 *   npx tsx src/scripts/oracle-cron.ts
 *
 * Cron example (every 15 minutes):
 *   0,15,30,45 * * * * cd /app && npx tsx src/scripts/oracle-cron.ts >> /var/log/oracle-cron.log 2>&1
 */

import { runOracleUpdate, initializeOracle } from '../lib/clankton-oracle';

async function main() {
  console.log(`[ORACLE CRON] Starting at ${new Date().toISOString()}`);

  try {
    // Initialize oracle (checks contract accessibility)
    const initialized = await initializeOracle();

    if (!initialized) {
      console.error('[ORACLE CRON] Failed to initialize oracle');
      process.exit(1);
    }

    // Run the update
    await runOracleUpdate();

    console.log(`[ORACLE CRON] Completed at ${new Date().toISOString()}`);
    process.exit(0);
  } catch (error) {
    console.error('[ORACLE CRON] Fatal error:', error);
    process.exit(1);
  }
}

main();
