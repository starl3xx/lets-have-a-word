import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import {
  generateBytes32Salt,
  computeWordCommitHash,
  verifyWordCommitHash,
  createRoundCommitment,
} from '../lib/commit-reveal';
import { selectBonusWords, getAnswerWords } from '../lib/word-lists';

// BURN_WORDS_PER_ROUND from config/economy (avoid importing burn-words.ts which needs DB)
const BURN_WORDS_PER_ROUND = 5;

describe('Onchain Commitment V2 (keccak256)', () => {
  describe('generateBytes32Salt', () => {
    it('should generate 0x-prefixed 32-byte hex strings', () => {
      const salt = generateBytes32Salt();
      expect(salt).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('should generate unique salts', () => {
      const salt1 = generateBytes32Salt();
      const salt2 = generateBytes32Salt();
      expect(salt1).not.toBe(salt2);
    });
  });

  describe('computeWordCommitHash', () => {
    it('should produce consistent hashes for same inputs', () => {
      const salt = generateBytes32Salt();
      const word = 'CRANE';
      const hash1 = computeWordCommitHash(word, salt);
      const hash2 = computeWordCommitHash(word, salt);
      expect(hash1).toBe(hash2);
    });

    it('should produce 0x-prefixed bytes32 hashes', () => {
      const salt = generateBytes32Salt();
      const hash = computeWordCommitHash('CRANE', salt);
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('should uppercase words before hashing', () => {
      const salt = generateBytes32Salt();
      const hash1 = computeWordCommitHash('crane', salt);
      const hash2 = computeWordCommitHash('CRANE', salt);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different words', () => {
      const salt = generateBytes32Salt();
      const hash1 = computeWordCommitHash('CRANE', salt);
      const hash2 = computeWordCommitHash('SLATE', salt);
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different salts', () => {
      const salt1 = generateBytes32Salt();
      const salt2 = generateBytes32Salt();
      const hash1 = computeWordCommitHash('CRANE', salt1);
      const hash2 = computeWordCommitHash('CRANE', salt2);
      expect(hash1).not.toBe(hash2);
    });

    it('should match Solidity keccak256(abi.encodePacked(string, bytes32))', () => {
      // Critical: our JS hash MUST match what Solidity computes
      const word = 'CRANE';
      const salt = '0x' + '00'.repeat(32); // Deterministic zero salt

      const hash = computeWordCommitHash(word, salt);

      // Manually compute what Solidity would do:
      const expectedHash = ethers.solidityPackedKeccak256(
        ['string', 'bytes32'],
        [word, salt]
      );

      expect(hash).toBe(expectedHash);
    });
  });

  describe('verifyWordCommitHash', () => {
    it('should verify correct word + salt combination', () => {
      const salt = generateBytes32Salt();
      const word = 'BRAIN';
      const hash = computeWordCommitHash(word, salt);
      expect(verifyWordCommitHash(word, salt, hash)).toBe(true);
    });

    it('should reject wrong word', () => {
      const salt = generateBytes32Salt();
      const hash = computeWordCommitHash('CRANE', salt);
      expect(verifyWordCommitHash('SLATE', salt, hash)).toBe(false);
    });

    it('should reject wrong salt', () => {
      const salt1 = generateBytes32Salt();
      const salt2 = generateBytes32Salt();
      const hash = computeWordCommitHash('CRANE', salt1);
      expect(verifyWordCommitHash('CRANE', salt2, hash)).toBe(false);
    });

    it('should be case-insensitive on hash comparison', () => {
      const salt = generateBytes32Salt();
      const hash = computeWordCommitHash('CRANE', salt);
      expect(verifyWordCommitHash('CRANE', salt, hash.toUpperCase())).toBe(true);
    });
  });

  describe('createRoundCommitment', () => {
    const secretWord = 'CRANE';
    const bonusWords = ['BRAIN', 'SLATE', 'HOUSE', 'PLANT', 'WORLD', 'MUSIC', 'LIGHT', 'HEART', 'STORM', 'PEARL'];
    const burnWords = ['FLAME', 'GRIND', 'SHOCK', 'VOCAL', 'TWIST'];

    it('should generate commitments for all 16 words', () => {
      const commitment = createRoundCommitment(secretWord, bonusWords, burnWords);

      expect(commitment.secretHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(commitment.secretSalt).toMatch(/^0x[0-9a-f]{64}$/);
      expect(commitment.bonusWordHashes).toHaveLength(10);
      expect(commitment.bonusWordSalts).toHaveLength(10);
      expect(commitment.burnWordHashes).toHaveLength(5);
      expect(commitment.burnWordSalts).toHaveLength(5);
    });

    it('should use unique salts for every word', () => {
      const commitment = createRoundCommitment(secretWord, bonusWords, burnWords);

      const allSalts = [
        commitment.secretSalt,
        ...commitment.bonusWordSalts,
        ...commitment.burnWordSalts,
      ];

      const uniqueSalts = new Set(allSalts);
      expect(uniqueSalts.size).toBe(16);
    });

    it('should produce verifiable hashes for each word', () => {
      const commitment = createRoundCommitment(secretWord, bonusWords, burnWords);

      // Verify secret word
      expect(verifyWordCommitHash(secretWord, commitment.secretSalt, commitment.secretHash)).toBe(true);

      // Verify each bonus word
      for (let i = 0; i < bonusWords.length; i++) {
        expect(verifyWordCommitHash(
          bonusWords[i],
          commitment.bonusWordSalts[i],
          commitment.bonusWordHashes[i]
        )).toBe(true);
      }

      // Verify each burn word
      for (let i = 0; i < burnWords.length; i++) {
        expect(verifyWordCommitHash(
          burnWords[i],
          commitment.burnWordSalts[i],
          commitment.burnWordHashes[i]
        )).toBe(true);
      }
    });

    it('should reject wrong word index for bonus words', () => {
      const commitment = createRoundCommitment(secretWord, bonusWords, burnWords);

      // Trying to verify bonus word 0 with bonus word 1's salt should fail
      expect(verifyWordCommitHash(
        bonusWords[0],
        commitment.bonusWordSalts[1],
        commitment.bonusWordHashes[0]
      )).toBe(false);
    });

    it('should reject wrong word index for burn words', () => {
      const commitment = createRoundCommitment(secretWord, bonusWords, burnWords);

      // Trying to verify burn word 0 with burn word 1's salt should fail
      expect(verifyWordCommitHash(
        burnWords[0],
        commitment.burnWordSalts[1],
        commitment.burnWordHashes[0]
      )).toBe(false);
    });

    it('should throw if wrong number of bonus words', () => {
      expect(() => createRoundCommitment(secretWord, bonusWords.slice(0, 5), burnWords))
        .toThrow('Expected 10 bonus words');
    });

    it('should throw if wrong number of burn words', () => {
      expect(() => createRoundCommitment(secretWord, bonusWords, burnWords.slice(0, 3)))
        .toThrow('Expected 5 burn words');
    });
  });
});

describe('Burn word selection (full word list)', () => {
  it('should select burn words from the full WORDS list, not a themed pool', () => {
    const allAnswerWords = new Set(getAnswerWords());

    // selectBonusWords is what selectBurnWords delegates to
    // Run 20 trials to sample variety
    const allBurnWords = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const burns = selectBonusWords(BURN_WORDS_PER_ROUND, ['CRANE']);
      for (const w of burns) {
        allBurnWords.add(w.toUpperCase());
      }
    }

    // All burn words must be valid answer words
    for (const word of allBurnWords) {
      expect(allAnswerWords.has(word)).toBe(true);
    }

    // With 20 trials * 5 words = 100 selections from 4,438 words,
    // we should see far more than 18 unique words (old themed pool size)
    expect(allBurnWords.size).toBeGreaterThan(18);
  });

  it('should select exactly 5 words', () => {
    const burns = selectBonusWords(BURN_WORDS_PER_ROUND, ['CRANE']);
    expect(burns).toHaveLength(5);
  });

  it('should exclude specified words', () => {
    const excludeWords = ['BRAIN', 'SLATE', 'HOUSE'];
    const burns = selectBonusWords(BURN_WORDS_PER_ROUND, excludeWords);

    for (const word of burns) {
      expect(excludeWords).not.toContain(word.toUpperCase());
    }
  });

  it('should return unique words', () => {
    const burns = selectBonusWords(BURN_WORDS_PER_ROUND, ['CRANE']);
    const uniqueBurns = new Set(burns.map(w => w.toUpperCase()));
    expect(uniqueBurns.size).toBe(burns.length);
  });
});

describe('Salt storage format', () => {
  it('should produce salts that fit in varchar(64) after stripping 0x prefix', () => {
    const salt = generateBytes32Salt();
    const stripped = salt.replace(/^0x/, '');
    expect(stripped.length).toBe(64);
    expect(stripped).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should correctly reconstruct 0x-prefixed salt from stored value', () => {
    const originalSalt = generateBytes32Salt();
    const stored = originalSalt.replace(/^0x/, '');
    const reconstructed = '0x' + stored;
    expect(reconstructed).toBe(originalSalt);

    // Verify it still produces the same hash
    const hash1 = computeWordCommitHash('CRANE', originalSalt);
    const hash2 = computeWordCommitHash('CRANE', reconstructed);
    expect(hash1).toBe(hash2);
  });
});
