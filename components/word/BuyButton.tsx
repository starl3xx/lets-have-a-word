/**
 * BuyButton Component
 * Milestone 14: Opens Farcaster wallet swap or GeckoTerminal fallback
 */

import sdk from '@farcaster/miniapp-sdk';
import { WORD_POOL_URL } from '../../config/economy';
import { useIsInMiniApp } from '../../src/hooks/useIsInMiniApp';

// Client-safe constant (cannot import from word-token.ts — server-only module)
const WORD_TOKEN_ADDRESS = '0x304e649e69979298bd1aee63e175adf07885fb4b';

interface BuyButtonProps {
  className?: string;
  size?: 'sm' | 'md';
}

export default function BuyButton({ className, size = 'md' }: BuyButtonProps) {
  const isInMiniApp = useIsInMiniApp();

  const handleBuy = async () => {
    // On plain web viewToken has no host to answer it and never settles —
    // the catch below is unreachable there — so branch before calling it
    if (!isInMiniApp) {
      window.open(WORD_POOL_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      // Try Farcaster viewToken action first (opens native swap UI)
      await sdk.actions.viewToken({
        token: `eip155:8453/erc20:${WORD_TOKEN_ADDRESS}`,
      });
    } catch (error) {
      // Fallback: open the public pool page
      window.open(WORD_POOL_URL, '_blank');
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
