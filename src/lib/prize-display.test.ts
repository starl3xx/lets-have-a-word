import { describe, it, expect } from 'vitest';
import {
  formatEthAmount,
  formatPrizeValue,
  formatPrize,
  prizeUnit,
  formatPrizeUsd,
  wordUsdValue,
  formatArchiveJackpot,
  formatArchiveSeed,
  formatArchiveShare,
  formatArchivePayoutEntry,
  bonusWordRewardRule,
  UNRECOVERABLE_AMOUNT,
} from './prize-display';
import { formatUsdCents } from './word-amounts';
import { BONUS_WORD_USD_CENTS } from '../../config/economy';

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

/**
 * The public archive rounds its $WORD the way the info bar and the in-game
 * round modal do; the admin table, which shares these helpers, keeps every
 * digit so an operator can reconcile a row against its payout tx. That is why
 * `compact` is an option on the call rather than a change to the helper.
 */
describe('archive amounts, compact (public archive)', () => {
  const wordRound = {
    currency: 'word',
    finalJackpotWord: (104_888_922n * ONE_TOKEN).toString(),
    seedWord: (40_000_000n * ONE_TOKEN).toString(),
    finalJackpotEth: null,
    seedEth: null,
  };
  const ethRound = {
    currency: 'eth',
    finalJackpotEth: '0.0216',
    seedEth: '0.0200',
    finalJackpotWord: null,
    seedWord: null,
  };

  it('rounds a $WORD pool to three significant digits', () => {
    expect(formatArchiveJackpot(wordRound)).toBe('104,888,922 $WORD');
    expect(formatArchiveJackpot(wordRound, { compact: true })).toBe('105M $WORD');
    expect(formatArchiveSeed(wordRound, { compact: true })).toBe('40.0M $WORD');
  });

  it('splits in wei before rounding, so a share keeps full precision', () => {
    // 80% of 104,888,922 is 83,911,137.6 — a float share of a ~1e26 wei pool
    // would have lost digits long before the rounding.
    expect(formatArchiveShare(wordRound, 8000)).toBe('83,911,137 $WORD');
    expect(formatArchiveShare(wordRound, 8000, { compact: true })).toBe('83.9M $WORD');
    expect(formatArchiveShare(wordRound, 500, { compact: true })).toBe('5.24M $WORD');
    expect(formatArchiveShare(wordRound, 1000, { compact: true })).toBe('10.5M $WORD');
  });

  it('rounds a payout entry the same way', () => {
    const entry = { amountWord: (5_244_446n * ONE_TOKEN).toString() };
    expect(formatArchivePayoutEntry(entry, 'word')).toBe('5,244,446 $WORD');
    expect(formatArchivePayoutEntry(entry, 'word', { compact: true })).toBe('5.24M $WORD');
  });

  /**
   * The invariant the whole change rests on. Rounds 1-33 sit on the same
   * screen as round 34+, and an ETH amount is four decimals either way, so the
   * compact flag must be a no-op for them — not merely similar, identical.
   */
  it('leaves every ETH amount byte-identical', () => {
    expect(formatArchiveJackpot(ethRound, { compact: true })).toBe(
      formatArchiveJackpot(ethRound)
    );
    expect(formatArchiveSeed(ethRound, { compact: true })).toBe(formatArchiveSeed(ethRound));
    expect(formatArchiveShare(ethRound, 8000, { compact: true })).toBe(
      formatArchiveShare(ethRound, 8000)
    );
    expect(formatArchivePayoutEntry({ amountEth: '0.0173' }, 'eth', { compact: true })).toBe(
      formatArchivePayoutEntry({ amountEth: '0.0173' }, 'eth')
    );
    expect(formatArchiveJackpot(ethRound, { compact: true })).toBe('0.0216 ETH');
  });

  it('still refuses to invent a number it does not have', () => {
    // A null seed means the opening pool could not be recovered, which is not
    // the same as a round that opened empty. Compacting must not turn the
    // first into a confident "0".
    expect(formatArchiveSeed({ currency: 'word', seedWord: null }, { compact: true })).toBe(
      UNRECOVERABLE_AMOUNT
    );
    expect(
      formatArchiveJackpot({ currency: 'word', finalJackpotWord: 'garbage' }, { compact: true })
    ).toBe('0 $WORD');
  });
});

describe('bonusWordRewardRule', () => {
  it('states the rule for the era being viewed, not a number', () => {
    expect(bonusWordRewardRule('eth')).toBe('5M $WORD each');
    expect(bonusWordRewardRule('word')).toBe('$1.50 of $WORD each');
  });

  /**
   * The copy spells out "$1.50" so that prize-display does not have to import
   * config/economy on the game's first paint. This is the tie that keeps the
   * two in step: move BONUS_WORD_USD_CENTS and this fails.
   */
  it('agrees with BONUS_WORD_USD_CENTS', () => {
    expect(bonusWordRewardRule('word')).toContain(formatUsdCents(BONUS_WORD_USD_CENTS));
  });
});
