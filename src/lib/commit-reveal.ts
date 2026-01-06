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

/**
 * Create a commitment for bonus words
 * Uses a master salt and generates individual salts for each word
 * Combined hash: H(masterSalt || salt1 || word1 || salt2 || word2 || ... || saltN || wordN)
 *
 * @param bonusWords Array of bonus words (10 words)
 * @returns Object with commit hash and individual salts for per-word verification
 */
export function createBonusWordsCommitment(bonusWords: string[]): {
  masterSalt: string;
  individualSalts: string[];
  commitHash: string;
} {
  const masterSalt = generateSalt();
  const individualSalts = bonusWords.map(() => generateSalt(16));

  // Combined commitment: masterSalt || (salt1 || word1) || (salt2 || word2) || ...
  let combined = masterSalt;
  for (let i = 0; i < bonusWords.length; i++) {
    combined += individualSalts[i] + bonusWords[i].toUpperCase();
  }

  const hash = createHash('sha256');
  hash.update(combined);
  const commitHash = hash.digest('hex');

  return {
    masterSalt,
    individualSalts,
    commitHash,
  };
}

/**
 * Verify that a bonus word was part of the original commitment
 *
 * @param word The claimed bonus word
 * @param wordIndex The index of the word (0-9)
 * @param wordSalt The individual salt for this word
 * @param masterSalt The master salt used for the commitment
 * @param allWords All bonus words for reconstruction
 * @param allSalts All individual salts
 * @param commitHash The original commit hash to verify against
 * @returns true if the bonus word was part of the original commitment
 */
export function verifyBonusWord(
  word: string,
  wordIndex: number,
  wordSalt: string,
  masterSalt: string,
  allWords: string[],
  allSalts: string[],
  commitHash: string
): boolean {
  // Verify the word at the given index matches
  if (allWords[wordIndex]?.toUpperCase() !== word.toUpperCase()) {
    return false;
  }
  if (allSalts[wordIndex] !== wordSalt) {
    return false;
  }

  // Reconstruct the full commitment and verify
  let combined = masterSalt;
  for (let i = 0; i < allWords.length; i++) {
    combined += allSalts[i] + allWords[i].toUpperCase();
  }

  const hash = createHash('sha256');
  hash.update(combined);
  const computed = hash.digest('hex');

  return computed === commitHash;
}

/**
 * Verify the entire bonus words commitment
 * Used for full reveal verification at round end
 *
 * @param masterSalt The master salt
 * @param allWords All bonus words
 * @param allSalts All individual salts
 * @param commitHash The original commit hash
 * @returns true if the commitment matches
 */
export function verifyBonusWordsCommitment(
  masterSalt: string,
  allWords: string[],
  allSalts: string[],
  commitHash: string
): boolean {
  let combined = masterSalt;
  for (let i = 0; i < allWords.length; i++) {
    combined += allSalts[i] + allWords[i].toUpperCase();
  }

  const hash = createHash('sha256');
  hash.update(combined);
  const computed = hash.digest('hex');

  return computed === commitHash;
}
