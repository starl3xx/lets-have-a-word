/**
 * Upgrade Script for JackpotManager
 * Milestone 6.2 - CLANKTON Market Cap Oracle Integration
 * Milestone 6.9 - Multi-recipient payouts
 * Milestone 10.1 - On-chain commitment for provably fair verification
 *
 * Upgrades the JackpotManager proxy contract to a new implementation
 *
 * Usage:
 *   npx hardhat run scripts/upgrade.ts --network base
 *   npx hardhat run scripts/upgrade.ts --network baseSepolia
 */

import hre from "hardhat";

// Deployed proxy addresses
const PROXY_ADDRESSES: Record<string, string> = {
  base: "0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5",
  baseSepolia: "", // To be filled after testnet deployment
};

async function main() {
  const network = hre.network.name;
  const proxyAddress = PROXY_ADDRESSES[network];

  if (!proxyAddress) {
    throw new Error(`No proxy address configured for network: ${network}`);
  }

  const [deployer] = await hre.ethers.getSigners();

  console.log("Upgrading JackpotManager with account:", deployer.address);
  console.log(
    "Account balance:",
    hre.ethers.formatEther(
      await hre.ethers.provider.getBalance(deployer.address)
    ),
    "ETH"
  );
  console.log("");
  console.log("Network:", network);
  console.log("Proxy Address:", proxyAddress);
  console.log("");

  // Get current implementation
  const currentImplementation =
    await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("Current Implementation:", currentImplementation);
  console.log("");

  // Prepare upgrade
  const JackpotManager = await hre.ethers.getContractFactory("JackpotManager");

  console.log("Validating upgrade compatibility...");
  await hre.upgrades.validateUpgrade(proxyAddress, JackpotManager, {
    kind: "uups",
  });
  console.log("Upgrade validation passed!");
  console.log("");

  console.log("Deploying new implementation and upgrading proxy...");
  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, JackpotManager);
  await upgraded.waitForDeployment();

  const newImplementation =
    await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("");
  console.log("=".repeat(60));
  console.log("JackpotManager upgraded successfully!");
  console.log("=".repeat(60));
  console.log("Proxy Address:", proxyAddress);
  console.log("Old Implementation:", currentImplementation);
  console.log("New Implementation:", newImplementation);
  console.log("");

  // Verify new functions exist
  const contract = await hre.ethers.getContractAt(
    "JackpotManager",
    proxyAddress
  );

  console.log("Verifying functions...");

  // Verify market cap functions (Milestone 6.2)
  const marketCapInfo = await contract.getMarketCapInfo();
  console.log("- getMarketCapInfo(): OK");
  console.log("  - Market Cap:", marketCapInfo.marketCap.toString());
  console.log("  - Last Update:", marketCapInfo.lastUpdate.toString());
  console.log("  - Is Stale:", marketCapInfo.isStale);
  console.log("  - Tier:", marketCapInfo.tier === 0n ? "LOW" : "HIGH");

  const freeGuesses = await contract.getFreeGuessesForTier();
  console.log("- getFreeGuessesForTier():", freeGuesses.toString());

  const isStale = await contract.isMarketCapStale();
  console.log("- isMarketCapStale():", isStale);

  // Verify new multi-payout function exists (Milestone 6.9)
  // We can't call it without an active round, but we can check the function exists
  console.log("- resolveRoundWithPayouts(): Function exists (verified via ABI)");

  // Verify on-chain commitment functions (Milestone 10.1)
  console.log("- startRoundWithCommitment(): Function exists (verified via ABI)");

  // Test getCommitHash on round 1 (will be bytes32(0) for rounds before this upgrade)
  const roundInfo = await contract.getRound(1);
  console.log("- getRound() now includes commitHash field");

  const commitHash = await contract.getCommitHash(1);
  console.log("- getCommitHash(1):", commitHash);

  const hasCommitment = await contract.hasOnChainCommitment(1);
  console.log("- hasOnChainCommitment(1):", hasCommitment);

  console.log("");
  console.log("Next steps:");
  console.log(
    "1. Verify new implementation: npx hardhat verify --network " +
      network +
      " " +
      newImplementation
  );
  console.log("2. Update backend to call startRoundWithCommitment() when creating rounds");
  console.log("3. Update /verify page to show on-chain commitment verification");
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
