/**
 * Wordmark display constants — one home for the color classes so the
 * Lexicon grid and the detail modal never drift apart.
 *
 * Keys match WordmarkDefinition.color. The class strings are literals so
 * Tailwind's JIT scanner sees them.
 */

export const WORDMARK_COLORS: Record<string, { bg: string; ring: string }> = {
  purple: { bg: 'bg-purple-100', ring: '#c4b5fd' },
  cyan: { bg: 'bg-cyan-100', ring: '#67e8f9' },
  amber: { bg: 'bg-amber-100', ring: '#fcd34d' },
  indigo: { bg: 'bg-indigo-100', ring: '#a5b4fc' },
  rose: { bg: 'bg-rose-100', ring: '#fda4af' },
  emerald: { bg: 'bg-emerald-100', ring: '#6ee7b7' },
  sky: { bg: 'bg-sky-100', ring: '#7dd3fc' },
  orange: { bg: 'bg-orange-100', ring: '#fdba74' },
  red: { bg: 'bg-red-100', ring: '#fca5a5' },
  violet: { bg: 'bg-violet-100', ring: '#c4b5fd' },
  pink: { bg: 'bg-pink-100', ring: '#f9a8d4' },
  teal: { bg: 'bg-teal-100', ring: '#5eead4' },
};

export const WORDMARK_COLOR_FALLBACK = { bg: 'bg-gray-100', ring: '#d1d5db' };
