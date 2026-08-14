import { describe, it, expect } from 'vitest';
import { isValidVerifiedAccount, ATTESTATION_CONSTANTS, type AttestationFields } from './attestations';

/**
 * These rules decide who bypasses the sybil gate, so each one gets a test that
 * fails if it is removed. The indexer is untrusted by design — it can point at
 * any attestation it likes — so every field below is a way something that looks
 * valid could get through.
 */

const WALLET = '0x1111111111111111111111111111111111111111';
const NOW = 1_800_000_000n;

function valid(overrides: Partial<AttestationFields> = {}): AttestationFields {
  return {
    schema: ATTESTATION_CONSTANTS.VERIFIED_ACCOUNT_SCHEMA,
    attester: ATTESTATION_CONSTANTS.COINBASE_ATTESTER,
    recipient: WALLET,
    revocationTime: 0n,
    expirationTime: 0n,
    ...overrides,
  };
}

describe('isValidVerifiedAccount', () => {
  it('accepts a Coinbase-issued, unrevoked, non-expiring attestation', () => {
    expect(isValidVerifiedAccount(valid(), WALLET, NOW)).toBe(true);
  });

  it('is case-insensitive about address and schema casing', () => {
    const mixedCase = valid({
      attester: ATTESTATION_CONSTANTS.COINBASE_ATTESTER.toLowerCase(),
      recipient: WALLET.toUpperCase().replace('0X', '0x'),
      schema: ATTESTATION_CONSTANTS.VERIFIED_ACCOUNT_SCHEMA.toUpperCase().replace('0X', '0x'),
    });
    expect(isValidVerifiedAccount(mixedCase, WALLET, NOW)).toBe(true);
  });

  it('rejects a different schema', () => {
    // e.g. Verified Country, which says nothing about account ownership
    const other = valid({
      schema: '0x1801901fabd0e6189356b4fb52bb0ab855276d84f7ec140839fbd1f6801ca065',
    });
    expect(isValidVerifiedAccount(other, WALLET, NOW)).toBe(false);
  });

  it('rejects an attester who is not Coinbase', () => {
    // Anyone may attest under any schema. Without this check a farm could
    // self-issue Verified Account attestations to its own wallets and walk
    // straight through the gate.
    const selfIssued = valid({ attester: '0xdeadbeef00000000000000000000000000000001' });
    expect(isValidVerifiedAccount(selfIssued, WALLET, NOW)).toBe(false);
  });

  it('rejects an attestation issued to a different wallet', () => {
    const someoneElse = valid({ recipient: '0x2222222222222222222222222222222222222222' });
    expect(isValidVerifiedAccount(someoneElse, WALLET, NOW)).toBe(false);
  });

  it('rejects a revoked attestation', () => {
    expect(isValidVerifiedAccount(valid({ revocationTime: NOW - 1n }), WALLET, NOW)).toBe(false);
  });

  it('rejects an expired attestation', () => {
    expect(isValidVerifiedAccount(valid({ expirationTime: NOW - 1n }), WALLET, NOW)).toBe(false);
  });

  it('treats an expiry exactly at now as expired', () => {
    expect(isValidVerifiedAccount(valid({ expirationTime: NOW }), WALLET, NOW)).toBe(false);
  });

  it('accepts an attestation that expires in the future', () => {
    expect(isValidVerifiedAccount(valid({ expirationTime: NOW + 1n }), WALLET, NOW)).toBe(true);
  });

  it('treats expirationTime 0 as never expiring rather than as long past', () => {
    // 0 is EAS's sentinel for "no expiry". Comparing it numerically without
    // the sentinel check would make every permanent attestation look expired.
    expect(isValidVerifiedAccount(valid({ expirationTime: 0n }), WALLET, NOW)).toBe(true);
  });
});
