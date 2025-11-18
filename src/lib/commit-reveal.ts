import { createHash, randomBytes } from 'crypto';

/**
 * Generate a cryptographically secure random salt
 * @param length Salt length in bytes (default 32)
 * @returns Hex-encoded salt string
 */
export function generateSalt(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Compute commit hash using SHA-256
 * Hash = H(salt || answer)
 *
 * @param salt Random salt (hex string)
 * @param answer The correct answer word
 * @returns Hex-encoded commit hash
 */
export function computeCommitHash(salt: string, answer: string): string {
  const hash = createHash('sha256');
  hash.update(salt + answer);
  return hash.digest('hex');
}

/**
 * Verify that a commit hash is valid
 *
 * @param salt The salt used in commitment
 * @param answer The claimed answer
 * @param commitHash The original commit hash to verify against
 * @returns true if H(salt||answer) === commitHash
 */
export function verifyCommit(salt: string, answer: string, commitHash: string): boolean {
  const computed = computeCommitHash(salt, answer);
  return computed === commitHash;
}

/**
 * Create a commitment for a new round
 * Returns salt, answer, and commit hash
 */
export function createCommitment(answer: string): {
  salt: string;
  commitHash: string;
} {
  const salt = generateSalt();
  const commitHash = computeCommitHash(salt, answer);

  return {
    salt,
    commitHash,
  };
}
