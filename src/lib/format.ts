/**
 * Shared formatting utilities for $WORD token amounts
 */

/**
 * Format a token amount string into a human-readable abbreviated form.
 * e.g. "2500000000" → "2.50B", "5000000" → "5.0M", "1500" → "1,500"
 */
export function formatTokenAmount(amount: string): string {
  const num = parseInt(amount, 10);
  if (isNaN(num) || num === 0) return '0';
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return num.toLocaleString('en-US');
}
