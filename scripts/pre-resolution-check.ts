/**
 * Pre-Resolution Diagnostic Check
 *
 * Run before resolving Round 1 (or any round) to verify everything is ready.
 *
 * Usage: npx ts-node scripts/pre-resolution-check.ts
 */

import { config } from 'dotenv';
config();

import { ethers } from 'ethers';
import { db } from '../src/db';
import { rounds, guesses } from '../src/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import {
  getContractRoundInfo,
  getCurrentJackpotOnChain,
  getMainnetContractBalance,
  getContractConfig,
} from '../src/lib/jackpot-contract';
import { isEncryptedAnswer } from '../src/lib/encryption';
import { computePrizeSplit } from '../src/lib/prize-split';
import { SEED_CAP_WEI } from '../src/lib/economics';

const DIVIDER = '═'.repeat(60);
const SECTION = '─'.repeat(40);

async function checkContractState() {
  console.log('\n📋 CONTRACT STATE');
  console.log(SECTION);

  try {
    const config = getContractConfig();
    const [roundInfo, internalJackpot, actualBalance] = await Promise.all([
      getContractRoundInfo(),
      getCurrentJackpotOnChain(),
      getMainnetContractBalance(),
    ]);

    const jackpotWei = ethers.parseEther(internalJackpot);
    const balanceWei = ethers.parseEther(actualBalance);
    const hasMismatch = balanceWei < jackpotWei;

    console.log(`Contract Address:    ${config.jackpotManagerAddress}`);
    console.log(`Round Number:        ${roundInfo.roundNumber}`);
    console.log(`Is Active:           ${roundInfo.isActive ? '✅ YES' : '❌ NO'}`);
    console.log(`Internal Jackpot:    ${internalJackpot} ETH`);
    console.log(`Actual Balance:      ${actualBalance} ETH`);
    console.log(`Balance Mismatch:    ${hasMismatch ? '⚠️  YES - RESOLUTION WILL FAIL' : '✅ NO'}`);
    console.log(`Can Resolve:         ${roundInfo.isActive && !hasMismatch ? '✅ YES' : '❌ NO'}`);

    return { ok: !hasMismatch && roundInfo.isActive, internalJackpot, actualBalance };
  } catch (error) {
    console.log(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { ok: false, internalJackpot: '0', actualBalance: '0' };
  }
}

async function checkDatabaseState() {
  console.log('\n📋 DATABASE STATE');
  console.log(SECTION);

  try {
    // Get active round
    const activeRound = await db.query.rounds.findFirst({
      where: eq(rounds.status, 'active'),
      orderBy: desc(rounds.id),
    });

    if (!activeRound) {
      console.log('❌ No active round found in database');
      return { ok: false };
    }

    // Column names, not invented ones. This block read `committedHash`,
    // `answerEncrypted`, `jackpotEth` and `globalGuessCount` — none of which
    // exist on `rounds`. Every one came back undefined, so the check printed
    // "❌ MISSING" for the commitment and the encrypted answer on every run and
    // returned ok:false unconditionally. A pre-resolution safety check that
    // always cries failure is worse than none: it trains you to ignore it.
    console.log(`Round ID:            ${activeRound.id}`);
    console.log(`Status:              ${activeRound.status === 'active' ? '✅ active' : activeRound.status}`);
    console.log(`Commit Hash:         ${activeRound.commitHash ? '✅ ' + activeRound.commitHash.slice(0, 20) + '...' : '❌ MISSING'}`);
    console.log(`Answer Encrypted:    ${isEncryptedAnswer(activeRound.answer) ? '✅ Present' : '❌ STORED AS PLAINTEXT'}`);
    console.log(`Prize Pool (DB):     ${activeRound.prizePoolEth} ETH`);
    console.log(`Started At:          ${activeRound.startedAt}`);

    // Get guess count from guesses table
    const guessCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(guesses)
      .where(eq(guesses.roundId, activeRound.id));

    console.log(`Guesses (verified):  ${guessCount[0]?.count || 0}`);

    return {
      ok: !!activeRound.commitHash && isEncryptedAnswer(activeRound.answer),
      roundId: activeRound.id,
      jackpotEth: activeRound.prizePoolEth,
    };
  } catch (error) {
    console.log(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { ok: false };
  }
}

async function checkOperatorWallet() {
  console.log('\n📋 OPERATOR WALLET');
  console.log(SECTION);

  try {
    const privateKey = process.env.OPERATOR_PRIVATE_KEY;
    if (!privateKey) {
      console.log('❌ OPERATOR_PRIVATE_KEY not set');
      return { ok: false };
    }

    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const balance = await provider.getBalance(wallet.address);
    const balanceEth = ethers.formatEther(balance);

    console.log(`Operator Address:    ${wallet.address}`);
    console.log(`ETH Balance:         ${balanceEth} ETH`);
    console.log(`Has Gas:             ${parseFloat(balanceEth) > 0.0005 ? '✅ YES' : '⚠️  LOW - may fail'}`);

    // Check if operator matches contract config
    const config = getContractConfig();
    const isConfiguredOperator = wallet.address.toLowerCase() === config.operatorWallet.toLowerCase();
    console.log(`Matches Config:      ${isConfiguredOperator ? '✅ YES' : '❌ NO - WRONG OPERATOR'}`);

    return { ok: parseFloat(balanceEth) > 0.0005 && isConfiguredOperator };
  } catch (error) {
    console.log(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { ok: false };
  }
}

async function checkEnvironmentVariables() {
  console.log('\n📋 ENVIRONMENT VARIABLES');
  console.log(SECTION);

  const required = [
    'DATABASE_URL',
    'BASE_RPC_URL',
    'OPERATOR_PRIVATE_KEY',
    'ANSWER_ENCRYPTION_KEY',
  ];

  let allPresent = true;
  for (const varName of required) {
    const present = !!process.env[varName];
    console.log(`${varName}: ${present ? '✅ Set' : '❌ MISSING'}`);
    if (!present) allPresent = false;
  }

  return { ok: allPresent };
}

async function checkPayoutCalculation() {
  console.log('\n📋 PAYOUT CALCULATION PREVIEW');
  console.log(SECTION);

  try {
    const activeRound = await db.query.rounds.findFirst({
      where: eq(rounds.status, 'active'),
      orderBy: desc(rounds.id),
    });

    if (!activeRound) {
      console.log('❌ No active round');
      return { ok: false };
    }

    // Computed with the same function resolution uses, rather than percentages
    // written out by hand. The hardcoded ones here were the pre-2026 split
    // (80 / 17.5 / 2.5), so this preview had been describing a division of the
    // prize pool the game stopped performing some time ago — on the screen you
    // consult immediately before resolving a round.
    const jackpotWei = ethers.parseEther(activeRound.prizePoolEth || '0');
    const fmt = (wei: bigint) => parseFloat(ethers.formatEther(wei)).toFixed(6);

    console.log(`Total Prize Pool:    ${fmt(jackpotWei)} ETH`);

    for (const hasReferrer of [false, true]) {
      const split = computePrizeSplit({ jackpotWei, hasReferrer, seedCapWei: SEED_CAP_WEI });
      console.log('');
      console.log(hasReferrer ? 'If winner HAS referrer:' : 'If winner has NO referrer:');
      console.log(`  Winner:            ${fmt(split.toWinnerWei)} ETH`);
      console.log(`  Top 10:            ${fmt(split.toTopGuessersWei)} ETH`);
      if (hasReferrer) {
        console.log(`  Referrer:          ${fmt(split.toReferrerWei)} ETH`);
      }
      console.log(`  Next Round (seed): ${fmt(split.seedForNextRoundWei)} ETH${split.seedWasCapped ? ' (at cap)' : ''}`);
      if (split.toCreatorOverflowWei > 0n) {
        console.log(`  Creator (overflow):${fmt(split.toCreatorOverflowWei)} ETH`);
      }
    }

    return { ok: true };
  } catch (error) {
    console.log(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { ok: false };
  }
}

async function main() {
  console.log(DIVIDER);
  console.log('🔍 PRE-RESOLUTION DIAGNOSTIC CHECK');
  console.log(DIVIDER);

  const results = {
    env: await checkEnvironmentVariables(),
    operator: await checkOperatorWallet(),
    contract: await checkContractState(),
    database: await checkDatabaseState(),
    payout: await checkPayoutCalculation(),
  };

  console.log('\n' + DIVIDER);
  console.log('📊 SUMMARY');
  console.log(DIVIDER);

  const allOk = Object.values(results).every(r => r.ok);

  console.log(`Environment:    ${results.env.ok ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Operator:       ${results.operator.ok ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Contract:       ${results.contract.ok ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Database:       ${results.database.ok ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Payout Calc:    ${results.payout.ok ? '✅ PASS' : '❌ FAIL'}`);

  console.log('\n' + DIVIDER);
  if (allOk) {
    console.log('✅ ALL CHECKS PASSED - READY FOR RESOLUTION');
  } else {
    console.log('⚠️  SOME CHECKS FAILED - REVIEW ABOVE');
  }
  console.log(DIVIDER + '\n');

  process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
