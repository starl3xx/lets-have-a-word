import { createHash, randomBytes } from 'crypto';
import { ethers } from 'ethers';

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

// =============================================================================
// Onchain commitment functions (keccak256 for Solidity verification)
// =============================================================================

/**
 * Generate a bytes32 salt for onchain commitment
 * @returns 0x-prefixed hex string (32 bytes = 66 chars with 0x prefix)
 */
export function generateBytes32Salt(): string {
  return '0x' + randomBytes(32).toString('hex');
}

/**
 * Compute a word commitment hash using keccak256
 * Matches Solidity: keccak256(abi.encodePacked(word, salt))
 *
 * @param word The word (will be uppercased)
 * @param salt bytes32 salt (0x-prefixed hex)
 * @returns bytes32 hash (0x-prefixed hex)
 */
export function computeWordCommitHash(word: string, salt: string): string {
  return ethers.solidityPackedKeccak256(
    ['string', 'bytes32'],
    [word.toUpperCase(), salt]
  );
}

/**
 * Verify a word commitment hash
 *
 * @param word The claimed word
 * @param salt The salt used
 * @param expectedHash The stored hash to verify against
 * @returns true if keccak256(abi.encodePacked(word, salt)) === expectedHash
 */
export function verifyWordCommitHash(word: string, salt: string, expectedHash: string): boolean {
  const computed = computeWordCommitHash(word, salt);
  return computed.toLowerCase() === expectedHash.toLowerCase();
}

/**
 * Result of creating a round commitment for all 16 words
 */
export interface RoundCommitmentData {
  /** Secret word keccak256 hash */
  secretHash: string;
  /** Secret word bytes32 salt */
  secretSalt: string;
  /** 10 bonus word keccak256 hashes */
  bonusWordHashes: string[];
  /** 10 bonus word bytes32 salts */
  bonusWordSalts: string[];
  /** 5 burn word keccak256 hashes */
  burnWordHashes: string[];
  /** 5 burn word bytes32 salts */
  burnWordSalts: string[];
}

/**
 * Create onchain commitments for all 16 words in a round
 * Generates unique bytes32 salts and keccak256 hashes for each word
 *
 * @param secretWord The secret answer word
 * @param bonusWords Array of 10 bonus words
 * @param burnWords Array of 5 burn words
 * @returns All salts and hashes needed for onchain commitment + later verification
 */
export function createRoundCommitment(
  secretWord: string,
  bonusWords: string[],
  burnWords: string[]
): RoundCommitmentData {
  if (bonusWords.length !== 10) {
    throw new Error(`Expected 10 bonus words, got ${bonusWords.length}`);
  }
  if (burnWords.length !== 5) {
    throw new Error(`Expected 5 burn words, got ${burnWords.length}`);
  }

  const secretSalt = generateBytes32Salt();
  const secretHash = computeWordCommitHash(secretWord, secretSalt);

  const bonusWordSalts = bonusWords.map(() => generateBytes32Salt());
  const bonusWordHashes = bonusWords.map((word, i) =>
    computeWordCommitHash(word, bonusWordSalts[i])
  );

  const burnWordSalts = burnWords.map(() => generateBytes32Salt());
  const burnWordHashes = burnWords.map((word, i) =>
    computeWordCommitHash(word, burnWordSalts[i])
  );

  return {
    secretHash,
    secretSalt,
    bonusWordHashes,
    bonusWordSalts,
    burnWordHashes,
    burnWordSalts,
  };
}
