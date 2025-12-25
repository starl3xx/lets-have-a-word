/**
 * Answer Encryption Module
 *
 * Provides AES-256-GCM encryption for the secret word.
 * The encryption key is stored in environment variables, NOT in the database.
 *
 * This means even a full database breach won't reveal active round answers.
 *
 * Key format: 64-character hex string (32 bytes)
 * Generate with: openssl rand -hex 32
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits

/**
 * Get the encryption key from environment
 * @throws Error if key is not configured or invalid
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.ANSWER_ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error(
      'ANSWER_ENCRYPTION_KEY is not configured. ' +
      'Generate one with: openssl rand -hex 32'
    );
  }

  if (keyHex.length !== 64) {
    throw new Error(
      'ANSWER_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ' +
      'Generate one with: openssl rand -hex 32'
    );
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypted answer format
 */
export interface EncryptedAnswer {
  ciphertext: string; // hex
  iv: string; // hex
  tag: string; // hex
}

/**
 * Encrypt the answer word using AES-256-GCM
 *
 * @param answer - The plaintext answer (5-letter word)
 * @returns Encrypted components (ciphertext, iv, tag) as hex strings
 */
export function encryptAnswer(answer: string): EncryptedAnswer {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(answer, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const tag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt the answer word using AES-256-GCM
 *
 * @param encrypted - The encrypted components
 * @returns The plaintext answer
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export function decryptAnswer(encrypted: EncryptedAnswer): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(encrypted.iv, 'hex');
  const tag = Buffer.from(encrypted.tag, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let plaintext = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Pack encrypted answer into a single string for storage
 * Format: iv:tag:ciphertext (all hex)
 */
export function packEncryptedAnswer(encrypted: EncryptedAnswer): string {
  return `${encrypted.iv}:${encrypted.tag}:${encrypted.ciphertext}`;
}

/**
 * Unpack encrypted answer from storage string
 * @throws Error if format is invalid
 */
export function unpackEncryptedAnswer(packed: string): EncryptedAnswer {
  const parts = packed.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted answer format');
  }

  const [iv, tag, ciphertext] = parts;

  return { iv, tag, ciphertext };
}

/**
 * Encrypt answer and pack into single storage string
 */
export function encryptAndPack(answer: string): string {
  const encrypted = encryptAnswer(answer);
  return packEncryptedAnswer(encrypted);
}

/**
 * Unpack and decrypt answer from storage string
 */
export function unpackAndDecrypt(packed: string): string {
  const encrypted = unpackEncryptedAnswer(packed);
  return decryptAnswer(encrypted);
}

/**
 * Check if a stored answer value is encrypted (vs legacy plaintext)
 * Encrypted format contains colons, plaintext is just 5 letters
 */
export function isEncryptedAnswer(storedValue: string): boolean {
  return storedValue.includes(':');
}

/**
 * Get the plaintext answer, handling both encrypted and legacy plaintext
 *
 * This provides backwards compatibility during migration:
 * - Old rounds: plaintext answer stored directly
 * - New rounds: encrypted answer stored as iv:tag:ciphertext
 */
export function getPlaintextAnswer(storedValue: string): string {
  if (isEncryptedAnswer(storedValue)) {
    return unpackAndDecrypt(storedValue);
  }
  // Legacy plaintext
  return storedValue;
}

/**
 * Validate that the encryption key is properly configured
 * Call this at startup to fail fast if misconfigured
 */
export function validateEncryptionConfig(): void {
  try {
    getEncryptionKey();

    // Test round-trip encryption
    const testWord = 'tests';
    const encrypted = encryptAndPack(testWord);
    const decrypted = unpackAndDecrypt(encrypted);

    if (decrypted !== testWord) {
      throw new Error('Encryption round-trip test failed');
    }

    console.log('✅ Answer encryption configured and working');
  } catch (error) {
    console.error('❌ Answer encryption configuration error:', error);
    throw error;
  }
}
