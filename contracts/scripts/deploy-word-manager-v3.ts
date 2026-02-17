/**
 * Deployment Script for WordManagerV3
 * Synthetix-style streaming staking rewards + game mechanics
 *
 * Deploys as a UUPS proxy (matching JackpotManagerV2 pattern).
 * Fresh deployment — V2 had zero stakers so no migration needed.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-word-manager-v3.ts --network base
 *   npx hardhat run scripts/deploy-word-manager-v3.ts --network baseSepolia
 *
 * After deployment:
 *   1. Set WORD_MANAGER_ADDRESS + NEXT_PUBLIC_WORD_MANAGER_ADDRESS in Vercel
 *   2. Transfer $WORD tokens to the proxy address
 *   3. Call notifyRewardAmount() via admin endpoint to start 30-day drip
 *   4. Verify on BaseScan
 */

import hre from "hardhat";

// $WORD token on Base mainnet
const WORD_TOKEN_ADDRESS = "0x304e649e69979298bd1aee63e175adf07885fb4b";

// Operator wallet (same as JackpotManager — server signs with OPERATOR_PRIVATE_KEY)
const OPERATOR_ADDRESS = "0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38";

// 30 days in seconds
const REWARDS_DURATION = 30 * 24 * 60 * 60; // 2592000

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying WordManagerV3 (UUPS proxy) with account:", deployer.address);
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
  console.log("  - Rewards Duration:", REWARDS_DURATION, "seconds (30 days)");
  console.log("");

  // Deploy as UUPS proxy
  const WordManagerV3 = await hre.ethers.getContractFactory("WordManagerV3");

  console.log("Deploying WordManagerV3 via UUPS proxy...");
  const proxy = await hre.upgrades.deployProxy(
    WordManagerV3,
    [WORD_TOKEN_ADDRESS, OPERATOR_ADDRESS, REWARDS_DURATION],
    { kind: "uups" }
  );
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("");
  console.log("=".repeat(60));
  console.log("WordManagerV3 deployed successfully!");
  console.log("=".repeat(60));
  console.log("Proxy Address:", proxyAddress);
  console.log("Implementation Address:", implementationAddress);
  console.log("Owner:", deployer.address);
  console.log("Operator:", OPERATOR_ADDRESS);
  console.log("$WORD Token:", WORD_TOKEN_ADDRESS);
  console.log("Rewards Duration:", REWARDS_DURATION, "seconds");
  console.log("");

  // Verify deployment
  const contract = await hre.ethers.getContractAt("WordManagerV3", proxyAddress);
  const duration = await contract.rewardsDuration();
  const op = await contract.operator();
  console.log("Verification:");
  console.log("  - rewardsDuration():", duration.toString());
  console.log("  - operator():", op);
  console.log("  - totalStaked():", (await contract.totalStaked()).toString());
  console.log("  - rewardRate():", (await contract.rewardRate()).toString());
  console.log("");

  console.log("Next steps:");
  console.log(`1. Set env vars in Vercel:`);
  console.log(`   WORD_MANAGER_ADDRESS=${proxyAddress}`);
  console.log(`   NEXT_PUBLIC_WORD_MANAGER_ADDRESS=${proxyAddress}`);
  console.log(`2. Transfer $WORD tokens to: ${proxyAddress}`);
  console.log(`3. Call notifyRewardAmount() via /api/admin/operational/fund-staking-pool`);
  console.log(`4. Verify implementation: npx hardhat verify --network ${hre.network.name} ${implementationAddress}`);
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
