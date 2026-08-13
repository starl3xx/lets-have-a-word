/**
 * Global test setup, run before every test file (see vitest.config.ts).
 *
 * No unit test should be making real onchain calls. Without this, any test that
 * resolves a round reaches resolveRoundAndCreatePayouts, which reads the prize
 * pool from JackpotManagerV3 and throws "Failed to query contract jackpot"
 * when no contract is configured — which is most of what kept the round
 * lifecycle, wheel and archive suites failing.
 *
 * economics.ts already exposed this switch for exactly this purpose; nothing
 * had ever set it. With it on, payouts are computed and written to the database
 * as normal and only the onchain transaction is skipped, so the logic under
 * test is still the real logic.
 */

import { beforeAll } from 'vitest';
import { setSkipOnchainResolution } from '../lib/economics';

beforeAll(() => {
  setSkipOnchainResolution(true);
});
