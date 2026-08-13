import { describe, it, expect } from 'vitest';
import {
  formatEthAmount,
  formatPrizeValue,
  formatPrize,
  prizeUnit,
  formatPrizeUsd,
  wordUsdValue,
} from './prize-display';

/**
 * Tests for the shared prize formatter.
 *
 * The behaviour that matters most is that nothing about how rounds 1-33 render
 * changes: this replaces a local formatEth in TopTicker, and the archive shows
 * ETH rounds beside $WORD rounds on the same screen.
 */

const ONE_TOKEN = 10n ** 18n;

describe('formatEthAmount', () => {
  it('always shows exactly 4 decimal places, as TopTicker did', () => {
    expect(formatEthAmount('0.0216')).toBe('0.0216');
    expect(formatEthAmount('0.02848')).toBe('0.0285');
    expect(formatEthAmount(1)).toBe('1.0000');
  });

  it('degrades to 0.0000 rather than NaN', () => {
    expect(formatEthAmount('not a number')).toBe('0.0000');
  });
});

describe('formatPrizeValue', () => {
  it('renders an ETH round unchanged', () => {
    expect(formatPrizeValue({ currency: 'eth', eth: '0.0216' })).toBe('0.0216');
  });

  it('renders a $WORD round as whole thousands-separated tokens', () => {
    expect(
      formatPrizeValue({ currency: 'word', word: (78_125_000n * ONE_TOKEN).toString() })
    ).toBe('78,125,000');
  });

  it('does not blow up on a malformed $WORD amount', () => {
    // This renders the header on the game's main screen; a bad value must not
    // throw and blank it.
    expect(formatPrizeValue({ currency: 'word', word: 'garbage' })).toBe('0');
  });

  it('treats a missing amount as zero', () => {
    expect(formatPrizeValue({ currency: 'word', word: null })).toBe('0');
    expect(formatPrizeValue({ currency: 'eth', eth: null })).toBe('0.0000');
  });
});

describe('prizeUnit and formatPrize', () => {
  it('labels each currency', () => {
    expect(prizeUnit('eth')).toBe('ETH');
    expect(prizeUnit('word')).toBe('$WORD');
  });

  it('combines amount and unit', () => {
    expect(formatPrize({ currency: 'eth', eth: '0.0216' })).toBe('0.0216 ETH');
    expect(
      formatPrize({ currency: 'word', word: (78_125_000n * ONE_TOKEN).toString() })
    ).toBe('78,125,000 $WORD');
  });
});

describe('formatPrizeUsd', () => {
  it('formats to two decimals', () => {
    expect(formatPrizeUsd('20')).toBe('$20.00');
    expect(formatPrizeUsd(15.789)).toBe('$15.79');
  });

  it('returns null rather than a misleading $0.00', () => {
    expect(formatPrizeUsd(null)).toBeNull();
    expect(formatPrizeUsd(undefined)).toBeNull();
    expect(formatPrizeUsd('')).toBeNull();
    expect(formatPrizeUsd(0)).toBeNull();
    expect(formatPrizeUsd('nonsense')).toBeNull();
  });
});

describe('wordUsdValue', () => {
  const PRICE_E18 = 256_000_000_000n; // $0.000000256

  it('values a seed at its USD target', () => {
    expect(wordUsdValue((78_125_000n * ONE_TOKEN).toString(), PRICE_E18.toString())).toBe(
      '20.00'
    );
  });

  it('returns null when either input is missing', () => {
    expect(wordUsdValue(null, PRICE_E18.toString())).toBeNull();
    expect(wordUsdValue('1', null)).toBeNull();
  });

  it('returns null on a zero price instead of dividing by it', () => {
    expect(wordUsdValue((ONE_TOKEN).toString(), '0')).toBeNull();
  });

  it('returns null on malformed input rather than throwing', () => {
    expect(wordUsdValue('garbage', PRICE_E18.toString())).toBeNull();
  });
});
