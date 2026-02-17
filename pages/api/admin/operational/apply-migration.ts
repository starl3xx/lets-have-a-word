/**
 * POST /api/admin/operational/apply-migration
 *
 * Apply a specific migration by name.
 * Used when migrations can't be run via CLI.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../../admin/me';

const MIGRATIONS: Record<string, string> = {
  '0015_start_tx_hash': `
    ALTER TABLE rounds
    ADD COLUMN IF NOT EXISTS start_tx_hash VARCHAR(66);
  `,
  '0006_airdrop_manager': `
    CREATE TABLE IF NOT EXISTS airdrop_wallets (
      id SERIAL PRIMARY KEY,
      wallet_address VARCHAR(42) NOT NULL UNIQUE,
      snapshot_token VARCHAR(20) NOT NULL DEFAULT 'CLANKTON',
      snapshot_balance NUMERIC(30, 0) NOT NULL,
      snapshot_date VARCHAR(20),
      current_word_balance NUMERIC(30, 2),
      airdrop_needed NUMERIC(30, 2),
      balance_last_checked_at TIMESTAMP,
      balance_check_error VARCHAR(500),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS airdrop_wallets_wallet_idx ON airdrop_wallets(wallet_address);
    CREATE TABLE IF NOT EXISTS airdrop_distributions (
      id SERIAL PRIMARY KEY,
      airdrop_wallet_id INTEGER NOT NULL REFERENCES airdrop_wallets(id),
      amount_sent NUMERIC(30, 2) NOT NULL,
      marked_by_fid INTEGER NOT NULL,
      tx_hash VARCHAR(66),
      note VARCHAR(500),
      sent_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS airdrop_distributions_wallet_idx ON airdrop_distributions(airdrop_wallet_id);
  `,
  '0007_seed_airdrop_holders': `
    INSERT INTO airdrop_wallets (wallet_address, snapshot_token, snapshot_balance, snapshot_date)
    VALUES
      ('0xb1058c959987e3513600eb5b4fd82aeee2a0e4f9', 'CLANKTON', 787180000, '2026-01-17'),
      ('0x0fc0f78fc939606db65f5bbf2f3715262c0b2f6e', 'CLANKTON', 648019154, '2026-01-17'),
      ('0x58a585909cccd4f84ebc3868db6da8d9882fee9c', 'CLANKTON', 593163676, '2026-01-17'),
      ('0x7e53246e4c3b1d5040f5a090b029277911efd874', 'CLANKTON', 566723171, '2026-01-17'),
      ('0x8f1b9d57ff7a0d238788a0c8c95c5eaf1e565a69', 'CLANKTON', 415376662, '2026-01-17'),
      ('0x7ae5333221a7dcd26eeb0194374ecd6d2be94479', 'CLANKTON', 408851785, '2026-01-17'),
      ('0x0c323730b96732d9e2a354863af9bbfce539b10d', 'CLANKTON', 372459866, '2026-01-17'),
      ('0x5c169b03959a3c8c84dfe9d45ed5848a98f9c890', 'CLANKTON', 349586984, '2026-01-17'),
      ('0xbf30608066f972e705b54fe75411e54b34d671c3', 'CLANKTON', 323751283, '2026-01-17'),
      ('0xec2a264f7dd45f3b641c4ff44bb9397b66fc40fb', 'CLANKTON', 300187501, '2026-01-17'),
      ('0xbcfcd3bb907507a123f9c37e920ceb5c8db56feb', 'CLANKTON', 298719865, '2026-01-17'),
      ('0x6a7b62fd5ad3943f6584b25884c555ed29569d87', 'CLANKTON', 295799645, '2026-01-17'),
      ('0x4e448534f7b0e50c4851f60bc5c78716ae22a137', 'CLANKTON', 233344165, '2026-01-17'),
      ('0x3cee630075dc586d5bfdfa81f3a2d77980f0d223', 'CLANKTON', 229228240, '2026-01-17'),
      ('0xbf55ce38c44b083e60ac7ea2a77d23eef2aac0f1', 'CLANKTON', 220247835, '2026-01-17'),
      ('0xf84a37f72ba55ddc994f9d0811a4060d2bf1c1bc', 'CLANKTON', 213062712, '2026-01-17'),
      ('0x1531f78a832baa682982c0783946f503bd89f969', 'CLANKTON', 208203985, '2026-01-17'),
      ('0x92e744854334a17f1b9a54e747bf52bbf6fb7450', 'CLANKTON', 161786558, '2026-01-17'),
      ('0xf2f47fde8a9ff83a0c9e38c0eb842d5f25487695', 'CLANKTON', 143987230, '2026-01-17'),
      ('0x47ce17a4dd59bb168345d140ecb6615cff0fa42d', 'CLANKTON', 136026165, '2026-01-17'),
      ('0xe3b811aa0ac620dcc6a27b767eb0d73ae9c56d12', 'CLANKTON', 132289198, '2026-01-17'),
      ('0xceab0087c5fbc22fb19293bd0be5fa9b23789da9', 'CLANKTON', 113091443, '2026-01-17'),
      ('0x8907f2a2a47a3a6f6e1cbf94e0dc5e1bd6486530', 'CLANKTON', 112570244, '2026-01-17'),
      ('0x75a5e92a54336141f7a4d3e87eebf57e0cf4239d', 'CLANKTON', 112410474, '2026-01-17'),
      ('0x85fa8cf9e409261b698d39840e05b1400afbe186', 'CLANKTON', 111020902, '2026-01-17'),
      ('0x5415692d9a10656de4af27993432fecd393cec6f', 'CLANKTON', 110045716, '2026-01-17'),
      ('0x19c64affde518de2884c1944700e12d2bb7016a4', 'CLANKTON', 109988827, '2026-01-17'),
      ('0x9353cc2583356ce6ea8f92e239d7c9eb8412acaf', 'CLANKTON', 106846020, '2026-01-17'),
      ('0xea9d6eac568e4173cf9a81378290cbcca5a2b2fd', 'CLANKTON', 106670306, '2026-01-17'),
      ('0xc6ee4d9f3bd6ba0288f329aaf19a60407b6ffdae', 'CLANKTON', 103398371, '2026-01-17'),
      ('0x19dd96094f3204fa76f65c7b109624cfb62fb17b', 'CLANKTON', 102248122, '2026-01-17'),
      ('0xc12d37fdd6bfeb298e76393db97dc51334594066', 'CLANKTON', 101250468, '2026-01-17'),
      ('0xff3bf4e0de78e31e4ea5141b2b876a46f76d342d', 'CLANKTON', 100560382, '2026-01-17'),
      ('0xcaf485690f38da17feb4f99f7e4164fa41f94e01', 'CLANKTON', 100420229, '2026-01-17'),
      ('0xd2db6ab0dc4743a77719b38d9f7196aa32fa519f', 'CLANKTON', 100222291, '2026-01-17'),
      ('0x8acffa55ac6490ac62f32b22f9a9db7232c2d38a', 'CLANKTON', 100000001, '2026-01-17'),
      ('0xf19782ed888d9e69533cb106f8af2d41be75f165', 'CLANKTON', 100000000, '2026-01-17')
    ON CONFLICT (wallet_address) DO NOTHING;
  `,
  '0008_airdrop_farcaster_handles': `
    ALTER TABLE airdrop_wallets ADD COLUMN IF NOT EXISTS farcaster_handle VARCHAR(100);
    UPDATE airdrop_wallets SET farcaster_handle = v.handle FROM (VALUES
      ('0x0fc0f78fc939606db65f5bbf2f3715262c0b2f6e', 'starl3xx.eth'),
      ('0xec2a264f7dd45f3b641c4ff44bb9397b66fc40fb', 'thepapercrane'),
      ('0xbcfcd3bb907507a123f9c37e920ceb5c8db56feb', 'myk'),
      ('0x8f1b9d57ff7a0d238788a0c8c95c5eaf1e565a69', 'mastermojo'),
      ('0x3cee630075dc586d5bfdfa81f3a2d77980f0d223', 'starl3xx.eth'),
      ('0x6a7b62fd5ad3943f6584b25884c555ed29569d87', 'sovereignstack'),
      ('0x1531f78a832baa682982c0783946f503bd89f969', 'bet'),
      ('0xceab0087c5fbc22fb19293bd0be5fa9b23789da9', 'garrett'),
      ('0x9353cc2583356ce6ea8f92e239d7c9eb8412acaf', 'nounishprof'),
      ('0xe3b811aa0ac620dcc6a27b767eb0d73ae9c56d12', 'cellar'),
      ('0x75a5e92a54336141f7a4d3e87eebf57e0cf4239d', 'oddlyaugmented.eth'),
      ('0xcaf485690f38da17feb4f99f7e4164fa41f94e01', 'nmeow.eth'),
      ('0x92e744854334a17f1b9a54e747bf52bbf6fb7450', 'greeny'),
      ('0x19c64affde518de2884c1944700e12d2bb7016a4', 'sky'),
      ('0xc6ee4d9f3bd6ba0288f329aaf19a60407b6ffdae', 'cryptomantis'),
      ('0xd2db6ab0dc4743a77719b38d9f7196aa32fa519f', 'birtcorn'),
      ('0xff3bf4e0de78e31e4ea5141b2b876a46f76d342d', 'faroff'),
      ('0x8acffa55ac6490ac62f32b22f9a9db7232c2d38a', 'kruukruu'),
      ('0x5415692d9a10656de4af27993432fecd393cec6f', 'katsudoon'),
      ('0xea9d6eac568e4173cf9a81378290cbcca5a2b2fd', 'mindlessmonk'),
      ('0x19dd96094f3204fa76f65c7b109624cfb62fb17b', 'mrautocrat'),
      ('0x85fa8cf9e409261b698d39840e05b1400afbe186', 'bmnr'),
      ('0xf19782ed888d9e69533cb106f8af2d41be75f165', 'hillside')
    ) AS v(addr, handle)
    WHERE airdrop_wallets.wallet_address = v.addr;
  `,
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Admin authentication via devFid
  let fid: number | undefined;
  if (req.query.devFid) {
    fid = parseInt(req.query.devFid as string, 10);
  } else if (req.cookies.siwn_fid) {
    fid = parseInt(req.cookies.siwn_fid, 10);
  }

  if (!fid || isNaN(fid)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!isAdminFid(fid)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { migration } = req.body;

    if (!migration || typeof migration !== 'string') {
      return res.status(400).json({
        error: 'migration name required',
        available: Object.keys(MIGRATIONS),
      });
    }

    const migrationSql = MIGRATIONS[migration];
    if (!migrationSql) {
      return res.status(400).json({
        error: `Unknown migration: ${migration}`,
        available: Object.keys(MIGRATIONS),
      });
    }

    console.log(`🔄 Applying migration: ${migration}`);
    await db.execute(sql.raw(migrationSql));
    console.log(`✅ Migration applied: ${migration}`);

    return res.status(200).json({
      success: true,
      migration,
      message: `Migration ${migration} applied successfully`,
    });
  } catch (error) {
    console.error('❌ Migration error:', error);
    return res.status(500).json({
      error: 'Migration failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
