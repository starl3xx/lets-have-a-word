-- Add farcaster_handle column and seed handles from walletlink export
-- Source: walletlink-export-2026-02-17.csv

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
