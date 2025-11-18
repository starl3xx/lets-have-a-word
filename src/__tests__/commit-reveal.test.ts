import { describe, it, expect } from 'vitest';
import {
  generateSalt,
  computeCommitHash,
  verifyCommit,
  createCommitment,
} from '../lib/commit-reveal';

describe('Commit-Reveal', () => {
  it('should generate random salts', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();

    expect(salt1).toBeDefined();
    expect(salt2).toBeDefined();
    expect(salt1).not.toBe(salt2); // Should be different
    expect(salt1.length).toBe(64); // 32 bytes = 64 hex chars
  });

  it('should compute consistent commit hashes', () => {
    const salt = 'test-salt-123';
    const answer = 'crane';

    const hash1 = computeCommitHash(salt, answer);
    const hash2 = computeCommitHash(salt, answer);

    expect(hash1).toBe(hash2); // Same input = same hash
    expect(hash1.length).toBe(64); // SHA-256 = 64 hex chars
  });

  it('should verify correct commits', () => {
    const salt = 'test-salt-456';
    const answer = 'slate';
    const commitHash = computeCommitHash(salt, answer);

    expect(verifyCommit(salt, answer, commitHash)).toBe(true);
  });

  it('should reject incorrect commits', () => {
    const salt = 'test-salt-789';
    const correctAnswer = 'crane';
    const wrongAnswer = 'slate';
    const commitHash = computeCommitHash(salt, correctAnswer);

    expect(verifyCommit(salt, wrongAnswer, commitHash)).toBe(false);
  });

  it('should create valid commitments', () => {
    const answer = 'audio';
    const { salt, commitHash } = createCommitment(answer);

    expect(salt).toBeDefined();
    expect(commitHash).toBeDefined();
    expect(verifyCommit(salt, answer, commitHash)).toBe(true);
  });

  it('should create unique commitments for same answer', () => {
    const answer = 'sharp';
    const commitment1 = createCommitment(answer);
    const commitment2 = createCommitment(answer);

    // Different salts
    expect(commitment1.salt).not.toBe(commitment2.salt);
    // Different commit hashes
    expect(commitment1.commitHash).not.toBe(commitment2.commitHash);
    // Both valid
    expect(verifyCommit(commitment1.salt, answer, commitment1.commitHash)).toBe(true);
    expect(verifyCommit(commitment2.salt, answer, commitment2.commitHash)).toBe(true);
  });
});
