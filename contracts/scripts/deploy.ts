/**
 * Deployment Script for JackpotManager
 * Milestone 6.1 - Smart Contract Specification
 *
 * Deploys the JackpotManager proxy contract to Base network
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network base
 *   npx hardhat run scripts/deploy.ts --network baseSepolia
 */

import { ethers, upgrades } from "hardhat";

// Wallet addresses from spec
const WALLETS = {
  // Prize Pool Wallet (letshaveaword.eth / letshaveaword.base.eth)
  prizePool: "0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB",

  // Operator Wallet (authorized for resolving rounds, seeding, config)
  operator: "0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38",

  // Creator Profit Wallet (receives profit share from paid guesses)
  creatorProfit: "0x3Cee630075DC586D5BFdFA81F3a2d77980F0d223",
};

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying JackpotManager with the account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("");
  console.log("Wallet Configuration:");
  console.log("  - Operator:", WALLETS.operator);
  console.log("  - Creator Profit:", WALLETS.creatorProfit);
  console.log("  - Prize Pool:", WALLETS.prizePool);
  console.log("");

  // Deploy upgradeable proxy
  const JackpotManager = await ethers.getContractFactory("JackpotManager");

  console.log("Deploying JackpotManager proxy...");

  const jackpotManager = await upgrades.deployProxy(
    JackpotManager,
    [WALLETS.operator, WALLETS.creatorProfit, WALLETS.prizePool],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );

  await jackpotManager.waitForDeployment();

  const proxyAddress = await jackpotManager.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("");
  console.log("=".repeat(60));
  console.log("JackpotManager deployed successfully!");
  console.log("=".repeat(60));
  console.log("Proxy Address:", proxyAddress);
  console.log("Implementation Address:", implementationAddress);
  console.log("");
  console.log("Next steps:");
  console.log("1. Update .env with JACKPOT_MANAGER_ADDRESS=" + proxyAddress);
  console.log("2. Verify contract: npx hardhat verify --network <network> " + implementationAddress);
  console.log("3. Seed initial jackpot with operator wallet");
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
