import { describe, it, expect } from 'vitest';
import { convertToTwitterText } from '../lib/twitter';

/**
 * Tweets must not be cut through a cashtag.
 *
 * Every announcer cast is cross-posted to X through this function, and several
 * name the token mid-string — the jackpot milestone casts carry "$WORD" in the
 * middle and sit close to the 280 limit. A blind `slice(0, 277)` cuts wherever
 * that character lands, so "$WORD" becomes "$WO..." and stops being a cashtag,
 * silently: the tweet still posts and still reads almost right.
 *
 * The audit found the codebase's $WORD convention was already correct
 * everywhere it is written. This was the one place it could be broken after
 * the fact.
 */
describe('tweet truncation', () => {
  it('does not cut through a cashtag', () => {
    // Position $WORD so a 277-character cut lands inside it.
    const prefix = 'x'.repeat(274);
    const text = `${prefix} $WORD is on the line for this round of the game`;
    expect(text.length).toBeGreaterThan(280);

    const out = convertToTwitterText(text);

    expect(out.length).toBeLessThanOrEqual(280);
    // Either the whole cashtag survives or it is dropped — never a fragment.
    expect(out).not.toMatch(/\$WO\.\.\.$/);
    expect(out).not.toMatch(/\$WOR\.\.\.$/);
    expect(out).not.toMatch(/\$W\.\.\.$/);
  });

  it('leaves a tweet within the limit untouched', () => {
    const text = 'Round #34 is live — 78,125,000 $WORD on the line 🎯';
    expect(convertToTwitterText(text)).toBe(text);
  });

  it('still truncates something with no word break near the end', () => {
    // A single enormous token must be cut rather than emptied.
    const text = 'y'.repeat(400);
    const out = convertToTwitterText(text);
    expect(out.length).toBeLessThanOrEqual(280);
    expect(out.length).toBeGreaterThan(200);
  });
});
