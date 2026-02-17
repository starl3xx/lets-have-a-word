/**
 * BuyButton Component
 * Milestone 14: Opens Farcaster wallet swap or DexScreener fallback
 */

import sdk from '@farcaster/miniapp-sdk';

// Client-safe constant (cannot import from word-token.ts — server-only module)
const WORD_TOKEN_ADDRESS = '0x304e649e69979298bd1aee63e175adf07885fb4b';

interface BuyButtonProps {
  className?: string;
  size?: 'sm' | 'md';
}

export default function BuyButton({ className, size = 'md' }: BuyButtonProps) {
  const handleBuy = async () => {
    try {
      // Try Farcaster viewToken action first (opens native swap UI)
      await sdk.actions.viewToken({
        token: `eip155:8453/erc20:${WORD_TOKEN_ADDRESS}`,
      });
    } catch (error) {
      // Fallback: open DexScreener
      const poolAddress = process.env.NEXT_PUBLIC_DEXSCREENER_POOL_ADDRESS;
      if (poolAddress) {
        window.open(`https://dexscreener.com/base/${poolAddress}`, '_blank');
      } else {
        window.open(`https://dexscreener.com/base/${WORD_TOKEN_ADDRESS}`, '_blank');
      }
    }
  };

  const sizeClasses = size === 'sm'
    ? 'py-2 px-4 text-sm'
    : 'py-2.5 px-5 text-base';

  return (
    <button
      onClick={handleBuy}
      className={`${sizeClasses} bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-700 hover:to-purple-600 text-white rounded-xl font-semibold transition-all ${className || ''}`}
    >
      Buy $WORD
    </button>
  );
}
