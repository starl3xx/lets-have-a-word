#!/usr/bin/env npx ts-node
/**
 * Sepolia Test Setup Script
 *
 * Funds the operator wallet and seeds the jackpot contract for testing.
 *
 * Usage:
 *   npx ts-node scripts/sepolia-setup.ts
 *
 * Required env vars:
 *   - BASE_RPC_URL: Sepolia RPC URL
 *   - JACKPOT_MANAGER_ADDRESS: Sepolia contract address
 *   - OPERATOR_PRIVATE_KEY: Operator wallet private key
 *   - FUNDER_PRIVATE_KEY: Wallet with Sepolia ETH to fund from (optional)
 */

import { ethers, Wallet, JsonRpcProvider } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// =============================================================================
// Configuration
// =============================================================================

const OPERATOR_FUND_AMOUNT = '0.1'; // ETH to send to operator for gas
const JACKPOT_SEED_AMOUNT = '0.2';  // ETH to seed jackpot contract

// =============================================================================
// Main Script
// =============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('SEPOLIA TEST SETUP');
  console.log('='.repeat(60));
  console.log('');

  // Validate environment
  const rpcUrl = process.env.BASE_RPC_URL;
  const jackpotAddress = process.env.JACKPOT_MANAGER_ADDRESS;
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY;
  const funderKey = process.env.FUNDER_PRIVATE_KEY;

  if (!rpcUrl) {
    console.error('ERROR: BASE_RPC_URL not set');
    process.exit(1);
  }

  if (!jackpotAddress) {
    console.error('ERROR: JACKPOT_MANAGER_ADDRESS not set');
    process.exit(1);
  }

  if (!operatorKey) {
    console.error('ERROR: OPERATOR_PRIVATE_KEY not set');
    process.exit(1);
  }

  // Connect to Sepolia
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`RPC: ${rpcUrl.substring(0, 30)}...`);
  console.log('');

  // Setup wallets
  const operatorWallet = new Wallet(operatorKey, provider);
  console.log(`Operator wallet: ${operatorWallet.address}`);

  // Check operator balance
  const operatorBalance = await provider.getBalance(operatorWallet.address);
  console.log(`Operator balance: ${ethers.formatEther(operatorBalance)} ETH`);

  // Check jackpot contract balance
  const jackpotBalance = await provider.getBalance(jackpotAddress);
  console.log(`Jackpot contract: ${jackpotAddress}`);
  console.log(`Jackpot balance: ${ethers.formatEther(jackpotBalance)} ETH`);
  console.log('');

  // If funder key provided, fund operator wallet
  if (funderKey) {
    const funderWallet = new Wallet(funderKey, provider);
    const funderBalance = await provider.getBalance(funderWallet.address);
    console.log(`Funder wallet: ${funderWallet.address}`);
    console.log(`Funder balance: ${ethers.formatEther(funderBalance)} ETH`);
    console.log('');

    // Fund operator if low
    if (operatorBalance < ethers.parseEther('0.05')) {
      console.log(`Funding operator with ${OPERATOR_FUND_AMOUNT} ETH...`);
      const tx = await funderWallet.sendTransaction({
        to: operatorWallet.address,
        value: ethers.parseEther(OPERATOR_FUND_AMOUNT),
      });
      console.log(`Transaction: ${tx.hash}`);
      await tx.wait();
      console.log('Operator funded!');
      console.log('');
    } else {
      console.log('Operator has sufficient balance, skipping funding.');
      console.log('');
    }
  }

  // Seed jackpot if low
  if (jackpotBalance < ethers.parseEther('0.1')) {
    console.log(`Seeding jackpot with ${JACKPOT_SEED_AMOUNT} ETH...`);

    // ABI for seedJackpot
    const abi = ['function seedJackpot() payable'];
    const contract = new ethers.Contract(jackpotAddress, abi, operatorWallet);

    const tx = await contract.seedJackpot({
      value: ethers.parseEther(JACKPOT_SEED_AMOUNT),
    });
    console.log(`Transaction: ${tx.hash}`);
    await tx.wait();
    console.log('Jackpot seeded!');
    console.log('');
  } else {
    console.log('Jackpot has sufficient balance, skipping seeding.');
    console.log('');
  }

  // Final status
  console.log('='.repeat(60));
  console.log('FINAL STATUS');
  console.log('='.repeat(60));

  const finalOperatorBalance = await provider.getBalance(operatorWallet.address);
  const finalJackpotBalance = await provider.getBalance(jackpotAddress);

  console.log(`Operator balance: ${ethers.formatEther(finalOperatorBalance)} ETH`);
  console.log(`Jackpot balance: ${ethers.formatEther(finalJackpotBalance)} ETH`);
  console.log('');
  console.log('Ready for Sepolia simulation testing!');
}

main().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
