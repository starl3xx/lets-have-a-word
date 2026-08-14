import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    // Applied to process.env before anything is imported — earlier than any
    // setup file can manage. announcer.ts and twitter.ts read these into
    // module-level consts at import time and both hard-stop unless NODE_ENV is
    // exactly 'production', so setting it here re-arms guards those files
    // already had. Sourcing .env.local (NODE_ENV=production,
    // ANNOUNCER_ENABLED=true) is what disarmed them and put 87 casts on the
    // live bot account on 2026-08-14.
    env: {
      NODE_ENV: 'test',
      ANNOUNCER_ENABLED: 'false',
      TWITTER_ENABLED: 'false',
      NEYNAR_SIGNER_UUID: '',
      NEYNAR_APP_UUID: '',
    },

    // setup-guards.ts must stay first: it refuses non-test databases and
    // imports nothing from src/, so it runs before setup.ts drags in
    // economics.ts → announcer.ts.
    setupFiles: ['./src/__tests__/setup-guards.ts', './src/__tests__/setup.ts'],
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // contracts/ holds Hardhat tests, which need the Hardhat runtime and
    // cannot execute under vitest — they were being collected and counted as
    // failures. They run via `cd contracts && npx hardhat test`, and in CI
    // through .github/workflows/contracts.yml.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'contracts/**'],
  },
});
