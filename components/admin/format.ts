/**
 * Shared admin formatters (Phase D3): every section carried private copies of
 * these; four implementations of "shorten an address" is three too many.
 */

export function formatEth(value: number | string, decimals = 4): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return num.toFixed(decimals);
}

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** B/M/K compact token counts for admin tables (one decimal). */
export function formatTokenCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return formatNumber(n);
}
