/**
 * Wagmi Configuration
 * Milestone 4.1 - Wallet Integration
 *
 * Configures Wagmi with Farcaster miniapp connector for wallet access
 */

import { createConfig, http } from 'wagmi';
import { base, mainnet } from 'wagmi/chains';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';

// ERC-8021 attribution suffix for Base Builder Code "bc_lul4sldw"
// Format: [codes(N)] [codesLength(1)] [schemaId(1)] [marker(16)]
// See https://docs.base.org/base-chain/quickstart/builder-codes
export const ERC_8021_SUFFIX = '0x62635f6c756c34736c64770b0080218021802180218021802180218021' as `0x${string}`;

/**
 * Wagmi configuration with Farcaster miniapp connector
 * Auto-connects to user's Farcaster wallet
 */
export const config = createConfig({
  chains: [base, mainnet],
  connectors: [farcasterMiniApp()],
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org'),
    [mainnet.id]: http(),
  },
  ssr: true,
});
