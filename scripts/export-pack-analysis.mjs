import postgres from 'postgres';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load env
config({ path: resolve(import.meta.dirname, '../.env.local') });

const sql = postgres(process.env.DATABASE_URL);

async function main() {
  // 1. Get all resolved rounds that started with < 0.04 ETH seed
  const rounds = await sql`
    SELECT
      ra.round_number,
      ra.target_word,
      ra.seed_eth,
      ra.final_jackpot_eth,
      ra.total_guesses,
      ra.unique_players,
      ra.winner_guess_number,
      ra.start_time,
      ra.end_time,
      EXTRACT(EPOCH FROM (ra.end_time - ra.start_time)) / 3600 AS duration_hours
    FROM round_archive ra
    WHERE ra.seed_eth::numeric < 0.04
    ORDER BY ra.round_number
  `;

  console.log(`Found ${rounds.length} rounds with seed < 0.04 ETH`);

  const roundIds = rounds.map(r => r.round_number);

  // 2. Get all pack purchases for those rounds
  const purchases = await sql`
    SELECT
      pp.round_id,
      pp.fid,
      pp.pack_count,
      pp.total_price_eth,
      pp.total_price_wei,
      pp.pricing_phase,
      pp.total_guesses_at_purchase,
      pp.created_at,
      u.username
    FROM pack_purchases pp
    LEFT JOIN users u ON u.fid = pp.fid
    WHERE pp.round_id = ANY(${roundIds})
    ORDER BY pp.round_id, pp.created_at
  `;

  console.log(`Found ${purchases.length} pack purchases across those rounds`);

  // 3. Get round economics config for pricing context
  const econ = await sql`
    SELECT round_id, config
    FROM round_economics_config
    WHERE round_id = ANY(${roundIds})
  `;
  const econByRound = Object.fromEntries(econ.map(e => [e.round_id, e.config]));

  // Build round lookup
  const roundMap = Object.fromEntries(rounds.map(r => [r.round_number, r]));

  // 4. Build CSV rows
  const headers = [
    'round_id',
    'round_seed_eth',
    'round_final_jackpot_eth',
    'round_total_guesses',
    'round_unique_players',
    'round_winner_guess_number',
    'round_start_time',
    'round_end_time',
    'round_duration_hours',
    'target_word',
    // Purchase fields
    'purchase_time',
    'username',
    'fid',
    'pack_count',
    'total_price_eth',
    'pricing_phase',
    'guesses_at_purchase',
    'pct_through_round',
    // Derived timing
    'minutes_into_round',
    // Economics config
    'base_price_eth',
    'price_ramp_start',
    'max_price_eth',
  ];

  const rows = [];

  for (const p of purchases) {
    const r = roundMap[p.round_id];
    if (!r) continue;

    const ec = econByRound[p.round_id]?.pricing;
    const roundStart = new Date(r.start_time);
    const purchaseTime = new Date(p.created_at);
    const minutesIn = (purchaseTime - roundStart) / 60000;
    const pctThrough = r.total_guesses > 0
      ? (p.total_guesses_at_purchase / r.total_guesses * 100).toFixed(1)
      : '0';

    rows.push([
      p.round_id,
      r.seed_eth,
      r.final_jackpot_eth,
      r.total_guesses,
      r.unique_players,
      r.winner_guess_number,
      r.start_time,
      r.end_time,
      Number(r.duration_hours).toFixed(2),
      r.target_word,
      p.created_at,
      p.username || '',
      p.fid,
      p.pack_count,
      p.total_price_eth,
      p.pricing_phase,
      p.total_guesses_at_purchase,
      pctThrough,
      minutesIn.toFixed(1),
      ec?.basePrice || '',
      ec?.priceRampStart || '',
      ec?.maxPrice || '',
    ]);
  }

  // 5. Also add a round summary sheet
  const summaryHeaders = [
    'round_id',
    'target_word',
    'seed_eth',
    'final_jackpot_eth',
    'total_guesses',
    'unique_players',
    'winner_guess_number',
    'start_time',
    'end_time',
    'duration_hours',
    'total_pack_purchases',
    'total_packs_sold',
    'total_revenue_eth',
    'unique_buyers',
    'avg_price_per_pack_eth',
    'purchases_in_base_phase',
    'purchases_in_late_phases',
  ];

  const summaryRows = [];
  for (const r of rounds) {
    const rPurchases = purchases.filter(p => p.round_id === r.round_number);
    const totalPacks = rPurchases.reduce((s, p) => s + p.pack_count, 0);
    const totalRevenue = rPurchases.reduce((s, p) => s + Number(p.total_price_eth), 0);
    const uniqueBuyers = new Set(rPurchases.map(p => p.fid)).size;
    const basePhase = rPurchases.filter(p => p.pricing_phase === 'BASE').length;
    const latePhases = rPurchases.filter(p => p.pricing_phase !== 'BASE').length;

    summaryRows.push([
      r.round_number,
      r.target_word,
      r.seed_eth,
      r.final_jackpot_eth,
      r.total_guesses,
      r.unique_players,
      r.winner_guess_number,
      r.start_time,
      r.end_time,
      Number(r.duration_hours).toFixed(2),
      rPurchases.length,
      totalPacks,
      totalRevenue.toFixed(6),
      uniqueBuyers,
      totalPacks > 0 ? (totalRevenue / totalPacks).toFixed(6) : '0',
      basePhase,
      latePhases,
    ]);
  }

  // Write CSVs
  const escapeCsv = (val) => {
    const s = String(val ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const purchaseCsv = [headers.join(',')]
    .concat(rows.map(r => r.map(escapeCsv).join(',')))
    .join('\n');

  const summaryCsv = [summaryHeaders.join(',')]
    .concat(summaryRows.map(r => r.map(escapeCsv).join(',')))
    .join('\n');

  const outDir = resolve(import.meta.dirname, '..');
  writeFileSync(`${outDir}/pack-purchases-analysis.csv`, purchaseCsv);
  writeFileSync(`${outDir}/round-summary-analysis.csv`, summaryCsv);

  console.log(`\nWrote pack-purchases-analysis.csv (${rows.length} rows)`);
  console.log(`Wrote round-summary-analysis.csv (${summaryRows.length} rows)`);

  // Quick stats
  console.log('\n--- Quick Stats ---');
  for (const r of rounds) {
    const rp = purchases.filter(p => p.round_id === r.round_number);
    const rev = rp.reduce((s, p) => s + Number(p.total_price_eth), 0);
    console.log(`Round ${r.round_number} (${r.target_word}): ${r.total_guesses} guesses, ${rp.length} purchases, ${rev.toFixed(4)} ETH revenue, seed ${r.seed_eth} ETH`);
  }

  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
