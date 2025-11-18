import { describe, it, expect, beforeEach } from 'vitest';
import { upsertUserFromFarcaster, getUserByFid } from './users';
import { db, users } from '../db';
import { sql } from 'drizzle-orm';

describe('User Management - Farcaster Integration', () => {
  // Clean up users table before each test
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users RESTART IDENTITY CASCADE`);
  });

  describe('upsertUserFromFarcaster', () => {
    it('should create a new user with FID and signer wallet', async () => {
      const result = await upsertUserFromFarcaster({
        fid: 100,
        signerWallet: '0x1234567890123456789012345678901234567890',
        spamScore: 50,
      });

      expect(result.fid).toBe(100);
      expect(result.signerWalletAddress).toBe('0x1234567890123456789012345678901234567890');
      expect(result.spamScore).toBe(50);
      expect(result.referrerFid).toBeNull();
      expect(result.xp).toBe(0);
    });

    it('should create a new user with referrer FID', async () => {
      const result = await upsertUserFromFarcaster({
        fid: 200,
        signerWallet: '0x1111111111111111111111111111111111111111',
        spamScore: 75,
        referrerFid: 999,
      });

      expect(result.fid).toBe(200);
      expect(result.referrerFid).toBe(999);
    });

    it('should reject self-referral', async () => {
      const result = await upsertUserFromFarcaster({
        fid: 300,
        signerWallet: '0x2222222222222222222222222222222222222222',
        spamScore: 60,
        referrerFid: 300, // Same as FID - should be rejected
      });

      expect(result.fid).toBe(300);
      expect(result.referrerFid).toBeNull(); // Should be null, not 300
    });

    it('should update existing user wallet and spam score', async () => {
      // Create initial user
      await upsertUserFromFarcaster({
        fid: 400,
        signerWallet: '0x3333333333333333333333333333333333333333',
        spamScore: 40,
      });

      // Update with new wallet and spam score
      const updated = await upsertUserFromFarcaster({
        fid: 400,
        signerWallet: '0x4444444444444444444444444444444444444444',
        spamScore: 80,
      });

      expect(updated.fid).toBe(400);
      expect(updated.signerWalletAddress).toBe('0x4444444444444444444444444444444444444444');
      expect(updated.spamScore).toBe(80);
    });

    it('should not overwrite existing referrer on update', async () => {
      // Create user with referrer
      await upsertUserFromFarcaster({
        fid: 500,
        signerWallet: '0x5555555555555555555555555555555555555555',
        spamScore: 50,
        referrerFid: 888,
      });

      // Try to update with different referrer
      const updated = await upsertUserFromFarcaster({
        fid: 500,
        signerWallet: '0x5555555555555555555555555555555555555555',
        spamScore: 60,
        referrerFid: 777, // This should be ignored
      });

      expect(updated.referrerFid).toBe(888); // Should still be original referrer
    });

    it('should handle null wallet and spam score', async () => {
      const result = await upsertUserFromFarcaster({
        fid: 600,
        signerWallet: null,
        spamScore: null,
      });

      expect(result.fid).toBe(600);
      expect(result.signerWalletAddress).toBeNull();
      expect(result.spamScore).toBeNull();
    });

    it('should not update if values are unchanged', async () => {
      // Create initial user
      const initial = await upsertUserFromFarcaster({
        fid: 700,
        signerWallet: '0x7777777777777777777777777777777777777777',
        spamScore: 70,
      });

      const initialUpdatedAt = initial.updatedAt;

      // Wait a bit to ensure timestamp would change if updated
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Call again with same values
      const result = await upsertUserFromFarcaster({
        fid: 700,
        signerWallet: '0x7777777777777777777777777777777777777777',
        spamScore: 70,
      });

      // updatedAt should not change if no actual update
      expect(result.updatedAt.getTime()).toBe(initialUpdatedAt.getTime());
    });
  });

  describe('getUserByFid', () => {
    it('should retrieve existing user by FID', async () => {
      await upsertUserFromFarcaster({
        fid: 800,
        signerWallet: '0x8888888888888888888888888888888888888888',
        spamScore: 85,
      });

      const user = await getUserByFid(800);

      expect(user).not.toBeNull();
      expect(user?.fid).toBe(800);
      expect(user?.signerWalletAddress).toBe('0x8888888888888888888888888888888888888888');
    });

    it('should return null for non-existent FID', async () => {
      const user = await getUserByFid(99999);
      expect(user).toBeNull();
    });
  });

  describe('Referral attribution', () => {
    it('should set referrer only on first user creation', async () => {
      // First user creation with referrer
      const user1 = await upsertUserFromFarcaster({
        fid: 1000,
        signerWallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        spamScore: 50,
        referrerFid: 9999,
      });

      expect(user1.referrerFid).toBe(9999);

      // Second call with different referrer (should be ignored)
      const user2 = await upsertUserFromFarcaster({
        fid: 1000,
        signerWallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        spamScore: 50,
        referrerFid: 8888,
      });

      expect(user2.referrerFid).toBe(9999); // Original referrer preserved
    });

    it('should ignore invalid referrer FIDs', async () => {
      const user = await upsertUserFromFarcaster({
        fid: 1100,
        signerWallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        spamScore: 50,
        referrerFid: 0, // Invalid
      });

      expect(user.referrerFid).toBeNull();
    });
  });
});
