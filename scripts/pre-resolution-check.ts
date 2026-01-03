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

    console.log(`Round ID:            ${activeRound.id}`);
    console.log(`Status:              ${activeRound.status === 'active' ? '✅ active' : activeRound.status}`);
    console.log(`Committed Hash:      ${activeRound.committedHash ? '✅ ' + activeRound.committedHash.slice(0, 20) + '...' : '❌ MISSING'}`);
    console.log(`Answer Encrypted:    ${activeRound.answerEncrypted ? '✅ Present' : '❌ MISSING'}`);
    console.log(`Jackpot ETH (DB):    ${activeRound.jackpotEth} ETH`);
    console.log(`Global Guess Count:  ${activeRound.globalGuessCount}`);
    console.log(`Started At:          ${activeRound.startedAt}`);

    // Get guess count from guesses table
    const guessCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(guesses)
      .where(eq(guesses.roundId, activeRound.id));

    console.log(`Guesses (verified):  ${guessCount[0]?.count || 0}`);

    return {
      ok: !!activeRound.committedHash && !!activeRound.answerEncrypted,
      roundId: activeRound.id,
      jackpotEth: activeRound.jackpotEth,
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

    const jackpot = parseFloat(activeRound.jackpotEth || '0');

    // Assuming no referrer for preview
    const winnerShare = jackpot * 0.80;
    const top10Share = jackpot * 0.175; // 10% + 7.5% if no referrer
    const seedShare = jackpot * 0.025;

    console.log(`Total Prize Pool:    ${jackpot.toFixed(6)} ETH`);
    console.log('');
    console.log('If winner has NO referrer:');
    console.log(`  Winner (80%):      ${winnerShare.toFixed(6)} ETH`);
    console.log(`  Top 10 (17.5%):    ${top10Share.toFixed(6)} ETH`);
    console.log(`  Next Round (2.5%): ${seedShare.toFixed(6)} ETH`);
    console.log('');
    console.log('If winner HAS referrer:');
    console.log(`  Winner (80%):      ${winnerShare.toFixed(6)} ETH`);
    console.log(`  Referrer (10%):    ${(jackpot * 0.10).toFixed(6)} ETH`);
    console.log(`  Top 10 (10%):      ${(jackpot * 0.10).toFixed(6)} ETH`);

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
