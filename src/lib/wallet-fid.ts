/**
 * The synthetic FID range, in a module with NO imports.
 *
 * These two live apart from users.ts on purpose. users.ts imports the database
 * layer, so anything that reaches for `isWalletFid` from there drags Postgres
 * into its module graph — and player-display.ts is imported by CLIENT
 * components, where that ends as "Module not found: Can't resolve 'fs'" at
 * build time. Splitting the constant out is the smallest fix that keeps one
 * definition rather than two copies of 1_000_000_000 drifting apart.
 *
 * users.ts re-exports both, so every existing import keeps working.
 */

/**
 * Floor of the synthetic FID range used by wallet-native players.
 *
 * Must match the START/MINVALUE of wallet_player_fid_seq in
 * migrations/0031_wallet_identity.sql. Real Farcaster FIDs are around 1-2M, and
 * users.fid is a Postgres `integer` capped at 2,147,483,647, so this reserves
 * ~1.1B ids with no collision risk in either direction.
 */
export const WALLET_FID_MIN = 1_000_000_000;

/** True when this FID was minted for a wallet player rather than issued by Farcaster. */
export function isWalletFid(fid: number): boolean {
  return fid >= WALLET_FID_MIN;
}
