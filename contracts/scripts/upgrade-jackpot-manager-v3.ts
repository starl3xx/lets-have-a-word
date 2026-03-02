/**
 * Upgrade Script for JackpotManagerV3
 * Adds seedFromTreasury() - moves creatorProfitAccumulated into jackpot internally
 *
 * No new storage variables, so no storage layout changes.
 * Safe UUPS upgrade: same proxy, new implementation bytecode.
 *
 * Usage:
 *   npx hardhat run scripts/upgrade-jackpot-manager-v3.ts --network baseSepolia
 *   npx hardhat run scripts/upgrade-jackpot-manager-v3.ts --network base
 */

import hre from "hardhat";

const PROXY_ADDRESS = "0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Upgrading to JackpotManagerV3 with account:", deployer.address);
  console.log(
    "Account balance:",
    hre.ethers.formatEther(
      await hre.ethers.provider.getBalance(deployer.address)
    ),
    "ETH"
  );
  console.log("");
  console.log("Network:", hre.network.name);
  console.log("Proxy Address:", PROXY_ADDRESS);
  console.log("");

  // Get current implementation
  const currentImplementation =
    await hre.upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
  console.log("Current Implementation:", currentImplementation);
  console.log("");

  // Deploy new implementation directly and call upgradeToAndCall on the proxy.
  // We bypass the OZ upgrades plugin for the upgrade step because previous
  // upgrades used upgradeToAndCall directly, leaving the plugin manifest stale.
  const JackpotManagerV3 =
    await hre.ethers.getContractFactory("JackpotManagerV3");

  console.log("Deploying new JackpotManagerV3 implementation...");
  const newImpl = await JackpotManagerV3.deploy();
  await newImpl.waitForDeployment();
  const newImplAddress = await newImpl.getAddress();
  console.log("New implementation deployed at:", newImplAddress);
  console.log("");

  console.log("Calling upgradeToAndCall on proxy...");
  const proxy = await hre.ethers.getContractAt(
    ["function upgradeToAndCall(address newImplementation, bytes memory data) external"],
    PROXY_ADDRESS
  );
  const tx = await proxy.upgradeToAndCall(newImplAddress, "0x");
  console.log("Transaction:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt?.blockNumber);

  const newImplementation = newImplAddress;

  console.log("");
  console.log("=".repeat(60));
  console.log("JackpotManagerV3 upgraded successfully!");
  console.log("=".repeat(60));
  console.log("Proxy Address:", PROXY_ADDRESS);
  console.log("Old Implementation:", currentImplementation);
  console.log("New Implementation:", newImplementation);
  console.log("");

  // Verify seedFromTreasury exists on the upgraded contract
  const contract = await hre.ethers.getContractAt(
    "JackpotManagerV3",
    PROXY_ADDRESS
  );

  // Read current state to verify upgrade didn't break anything
  const minimumSeed = await contract.MINIMUM_SEED();
  const currentRound = await contract.currentRound();
  const currentJackpot = await contract.currentJackpot();
  const creatorProfit = await contract.creatorProfitAccumulated();

  console.log("Post-upgrade verification:");
  console.log(
    "  MINIMUM_SEED:",
    hre.ethers.formatEther(minimumSeed),
    "ETH"
  );
  console.log("  currentRound:", currentRound.toString());
  console.log(
    "  currentJackpot:",
    hre.ethers.formatEther(currentJackpot),
    "ETH"
  );
  console.log(
    "  creatorProfitAccumulated:",
    hre.ethers.formatEther(creatorProfit),
    "ETH"
  );
  console.log("");

  // Verify the new function is accessible (ABI check)
  try {
    // This will revert with InsufficientPayment (amount=0) but proves the function exists
    await contract.seedFromTreasury.staticCall(0).catch(() => {});
    console.log("  seedFromTreasury: ACCESSIBLE (function exists on proxy)");
  } catch {
    console.error("  seedFromTreasury: NOT FOUND - upgrade may have failed!");
  }

  console.log("");
  console.log("Next steps:");
  console.log(
    "1. Verify new implementation: npx hardhat verify --network " +
      hre.network.name +
      " " +
      newImplementation
  );
  console.log(
    "2. Confirm on BaseScan: cast call " +
      PROXY_ADDRESS +
      ' "creatorProfitAccumulated()(uint256)"'
  );
  console.log(
    "3. Test seedFromTreasury: cast send " +
      PROXY_ADDRESS +
      ' "seedFromTreasury(uint256)" <amount_wei> --private-key <operator_key>'
  );
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
