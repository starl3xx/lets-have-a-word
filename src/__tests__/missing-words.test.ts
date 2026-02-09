/**
 * Test for missing valid English words
 * 
 * Bug report: DIMMERS was rejected but it's a valid English word
 * - DIMMER (noun): A device that dims lights
 * - DIMMER (adj): Comparative form of DIM
 * - DIMMERS (noun): Plural of DIMMER
 */

import { isValidGuess } from '../lib/word-lists';

describe('Missing valid words', () => {
  describe('DIMMER/DIMMERS', () => {
    it('should accept DIMMER as a valid word', () => {
      expect(isValidGuess('DIMMER')).toBe(true);
    });

    it('should accept DIMMERS as a valid word', () => {
      expect(isValidGuess('DIMMERS')).toBe(true);
    });

    it('should accept dimmers in lowercase (normalized)', () => {
      expect(isValidGuess('dimmers')).toBe(true);
    });
  });
});
