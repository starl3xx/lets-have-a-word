/**
 * Deployment Script for WordManagerV2
 * Milestone 14: $WORD Token Game Mechanics with Onchain Commitment Verification
 *
 * Deploys a standalone (non-proxy) WordManagerV2 contract to Base.
 * This contract handles:
 *   - Per-round commitment of 16 word hashes (1 secret + 10 bonus + 5 burn)
 *   - Verified bonus word reward claims (keccak256 hash check before transfer)
 *   - Verified burn word destruction (keccak256 hash check before burn)
 *   - Legacy compatibility (distributeBonusReward, burnWord, distributeTop10Rewards)
 *   - Staking
 *
 * Usage:
 *   npx hardhat run scripts/deploy-word-manager.ts --network base
 *   npx hardhat run scripts/deploy-word-manager.ts --network baseSepolia
 *
 * After deployment:
 *   1. Set WORD_MANAGER_ADDRESS in Vercel env vars
 *   2. Transfer $WORD tokens to the contract (for bonus rewards + burn operations)
 *   3. Verify on BaseScan: npx hardhat verify --network base <address> <wordTokenAddress>
 */

import hre from "hardhat";

// $WORD token on Base mainnet
const WORD_TOKEN_ADDRESS = "0x304e649e69979298bd1aee63e175adf07885fb4b";

// Operator wallet (same as JackpotManager — server signs with OPERATOR_PRIVATE_KEY)
const OPERATOR_ADDRESS = "0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying WordManagerV2 with account:", deployer.address);
  console.log(
    "Account balance:",
    hre.ethers.formatEther(
      await hre.ethers.provider.getBalance(deployer.address)
    ),
    "ETH"
  );
  console.log("");
  console.log("Configuration:");
  console.log("  - $WORD Token:", WORD_TOKEN_ADDRESS);
  console.log("  - Owner (deployer):", deployer.address);
  console.log("  - Operator:", OPERATOR_ADDRESS);
  console.log("");

  // Deploy WordManagerV2 (standalone, not proxy)
  const WordManagerV2 = await hre.ethers.getContractFactory("WordManagerV2");

  console.log("Deploying WordManagerV2...");
  const wordManager = await WordManagerV2.deploy(
    WORD_TOKEN_ADDRESS,
    OPERATOR_ADDRESS
  );
  await wordManager.waitForDeployment();

  const contractAddress = await wordManager.getAddress();

  console.log("");
  console.log("=".repeat(60));
  console.log("WordManagerV2 deployed successfully!");
  console.log("=".repeat(60));
  console.log("Contract Address:", contractAddress);
  console.log("Owner:", deployer.address);
  console.log("Operator:", OPERATOR_ADDRESS);
  console.log("$WORD Token:", WORD_TOKEN_ADDRESS);
  console.log("");
  console.log("Next steps:");
  console.log(`1. Set env var: WORD_MANAGER_ADDRESS=${contractAddress}`);
  console.log(`2. Transfer $WORD tokens to the contract for rewards/burns`);
  console.log(
    `3. Verify: npx hardhat verify --network ${hre.network.name} ${contractAddress} ${WORD_TOKEN_ADDRESS} ${OPERATOR_ADDRESS}`
  );
  console.log("");
  console.log("Access control:");
  console.log(`  - Owner (${deployer.address}): setOperator, emergencyWithdraw, transferOwnership`);
  console.log(`  - Operator (${OPERATOR_ADDRESS}): commitRound, claimBonusReward, claimBurnWord, legacy functions`);
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
