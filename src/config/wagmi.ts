/**
 * Wagmi Configuration
 * Milestone 4.1 - Wallet Integration
 *
 * Configures Wagmi with Farcaster miniapp connector for wallet access
 */

import { createConfig, http } from 'wagmi';
import { base, mainnet } from 'wagmi/chains';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';
import { baseAccount, injected } from 'wagmi/connectors';

// ERC-8021 attribution suffix for Base Builder Code "bc_lul4sldw"
// Format: [codes(N)] [codesLength(1)] [schemaId(1)] [marker(16)]
// See https://docs.base.org/base-chain/quickstart/builder-codes
export const ERC_8021_SUFFIX = '0x62635f6c756c34736c64770b0080218021802180218021802180218021' as `0x${string}`;

/**
 * Wagmi configuration.
 *
 * ORDER MATTERS AND FARCASTER STAYS FIRST. Inside a Farcaster host the mini app
 * connector auto-connects to the player's Farcaster wallet, and that behaviour
 * predates everything else here; the two connectors below are additions for
 * hosts where it cannot work at all.
 *
 * `injected` is the one that carries Base App: since 2026-04-09 Base App is not
 * a Farcaster mini app host, it is a webview that injects an EIP-1193 provider,
 * so `farcasterMiniApp()` has nothing to talk to there. `baseAccount` covers
 * plain web, where there is no injected provider and a Base Account popup is
 * the path to the same wallet.
 *
 * Adding connectors does not change what auto-connects: wagmi only reconnects
 * to a connector the user previously chose.
 */
export const config = createConfig({
  chains: [base, mainnet],
  connectors: [
    farcasterMiniApp(),
    injected(),
    baseAccount({
      appName: 'Let’s Have A Word!',
      appLogoUrl: 'https://www.letshaveaword.fun/LHAW-icon.png',
    }),
  ],
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org'),
    [mainnet.id]: http(),
  },
  ssr: true,
});
