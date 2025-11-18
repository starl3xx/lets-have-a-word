/**
 * Wagmi Configuration
 * Milestone 4.1 - Wallet Integration
 *
 * Configures Wagmi with Farcaster miniapp connector for wallet access
 */

import { createConfig, http } from 'wagmi';
import { base, mainnet } from 'wagmi/chains';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';

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
