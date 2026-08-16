/**
 * Farm Monitor signature tests
 *
 * Fixtures use the real production numbers (verified 2026-08-15) on the
 * MIN(guesses.round_id) basis: waves 28/29/33 must read farm-signature on
 * the name leg; round 32 (real-shaped names, high scores) must be invisible
 * to the name leg and caught by the funding leg; round 13's organic cohort
 * reads watch on volume, never farm-signature.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyUsername,
  computeAssessment,
  isSuspiciousUsername,
} from '../lib/farm-monitor';

describe('classifyUsername', () => {
  it('recognizes the known farm shapes', () => {
    expect(classifyUsername('swarm042.base.eth')).toBe('base_eth');
    expect(classifyUsername('SWARM042.BASE.ETH')).toBe('base_eth');
    expect(classifyUsername('!891234')).toBe('placeholder');
    expect(classifyUsername('user-2924790')).toBe('placeholder'); // round-31/32 winners' shape
    expect(classifyUsername('user1251667')).toBe('placeholder'); // 2025-09-14 dormant cohort shape
    expect(classifyUsername('username42')).toBe('real'); // trailing letters — a human handle
    expect(classifyUsername(null)).toBe('none');
    expect(classifyUsername(undefined)).toBe('none');
    expect(classifyUsername('')).toBe('none');
    expect(classifyUsername('jake')).toBe('real');
  });

  it('flags every non-real shape as suspicious', () => {
    expect(isSuspiciousUsername('a.base.eth')).toBe(true);
    expect(isSuspiciousUsername('!42')).toBe(true);
    expect(isSuspiciousUsername(null)).toBe(true);
    expect(isSuspiciousUsername('jake')).toBe(false);
  });
});

describe('computeAssessment', () => {
  it('flags the round-28 wave (2,949 new, 91% suspicious names)', () => {
    const { verdict } = computeAssessment({
      newGuessers: 2949,
      newGuessersSuspicious: 2681,
      topFunderFanout: 0,
    });
    expect(verdict).toBe('farm-signature');
  });

  it('flags the round-29 wave (913 new, 93% suspicious names)', () => {
    const { verdict } = computeAssessment({
      newGuessers: 913,
      newGuessersSuspicious: 847,
      topFunderFanout: 0,
    });
    expect(verdict).toBe('farm-signature');
  });

  it('flags the round-33 wave (1,591 new, 91% suspicious names)', () => {
    const { verdict } = computeAssessment({
      newGuessers: 1591,
      newGuessersSuspicious: 1453,
      topFunderFanout: 0,
    });
    expect(verdict).toBe('farm-signature');
  });

  it('cannot see the round-32 class on names alone — and says so', () => {
    // 59 new guessers, real-shaped usernames, Neynar scores 0.62–0.99.
    // Without funding data the round reads quiet; the reason string must
    // point at the untraced funding leg instead of implying all-clear.
    const { verdict, reasons } = computeAssessment({
      newGuessers: 59,
      newGuessersSuspicious: 1,
      topFunderFanout: 0,
      fundingUntraced: true,
    });
    expect(verdict).toBe('quiet');
    expect(reasons.join(' ')).toContain('funding not traced');
  });

  it('catches the round-32 class through the funding leg', () => {
    const { verdict, reasons } = computeAssessment({
      newGuessers: 59,
      newGuessersSuspicious: 1,
      topFunderFanout: 6,
    });
    expect(verdict).toBe('farm-signature');
    expect(reasons.join(' ')).toContain('funded 6 claim wallets');
  });

  it('reads the round-13 organic cohort as watch on volume, not farm', () => {
    // 111 new guessers, 19% suspicious — real Base-app users who stayed.
    const { verdict, reasons } = computeAssessment({
      newGuessers: 111,
      newGuessersSuspicious: 21,
      topFunderFanout: 0,
    });
    expect(verdict).toBe('watch');
    expect(reasons.join(' ')).toContain('organic');
  });

  it('puts a small shaped cohort on watch', () => {
    const { verdict } = computeAssessment({
      newGuessers: 12,
      newGuessersSuspicious: 10,
      topFunderFanout: 0,
    });
    expect(verdict).toBe('watch');
  });

  it('puts moderate funding fan-out on watch', () => {
    const { verdict } = computeAssessment({
      newGuessers: 3,
      newGuessersSuspicious: 0,
      topFunderFanout: 3,
    });
    expect(verdict).toBe('watch');
  });

  it('is quiet on an empty round', () => {
    const { verdict } = computeAssessment({
      newGuessers: 0,
      newGuessersSuspicious: 0,
      topFunderFanout: 0,
    });
    expect(verdict).toBe('quiet');
  });
});
