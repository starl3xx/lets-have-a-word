/**
 * Fee Recipients Configuration
 * Wallets that receive fees from the Uniswap V3 position as WETH (and native ETH)
 */

/** WETH contract on Base */
export const WETH_ADDRESS_BASE = '0x4200000000000000000000000000000000000006';

/** USDC contract on Base (6 decimals) */
export const USDC_ADDRESS_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** $WORD token contract on Base (18 decimals) */
export const WORD_ADDRESS_BASE = '0x304e649e69979298bd1aee63e175adf07885fb4b';

export interface FeeRecipient {
  id: string;
  name: string;
  address: string;
  bps: number;
  receives: 'WETH' | 'ETH' | 'BOTH';
}

export const FEE_RECIPIENTS: FeeRecipient[] = [
  {
    id: 'game-treasury',
    name: 'Game Treasury',
    address: '0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38',
    bps: 5000,
    receives: 'WETH',
  },
  {
    id: 'buyback-stake',
    name: 'Buyback & Stake',
    address: '0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB',
    bps: 2500,
    receives: 'WETH',
  },
  {
    id: 'player-rewards',
    name: 'Player Rewards',
    address: '0x1a5b29652219664a8f6072d2f7bc6306175aad26',
    bps: 1500,
    receives: 'BOTH',
  },
  {
    id: 'top10-referral',
    name: 'Top 10 / Referral',
    address: '0x24563994c868e1cf02eeccaef6f1079047ae2365',
    bps: 1000,
    receives: 'WETH',
  },
];
