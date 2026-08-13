import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // contracts/ holds Hardhat tests, which need the Hardhat runtime and
    // cannot execute under vitest — they were being collected and counted as
    // failures. They run via `cd contracts && npx hardhat test`, and in CI
    // through .github/workflows/contracts.yml.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'contracts/**'],
  },
});
