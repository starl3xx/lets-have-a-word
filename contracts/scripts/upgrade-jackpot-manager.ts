/**
 * Upgrade Script for JackpotManagerV2
 * Lowers MINIMUM_SEED from 0.03 ETH to 0.02 ETH
 *
 * Since MINIMUM_SEED is a Solidity `constant`, it's embedded in bytecode.
 * A UUPS upgrade replaces the implementation, so the proxy reads the new value.
 * No storage migration or reinitializer needed.
 *
 * Usage:
 *   npx hardhat run scripts/upgrade-jackpot-manager.ts --network base
 */

import hre from "hardhat";

const PROXY_ADDRESS = "0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Upgrading JackpotManagerV2 with account:", deployer.address);
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

  // Prepare upgrade
  const JackpotManagerV2 =
    await hre.ethers.getContractFactory("JackpotManagerV2");

  console.log("Validating upgrade compatibility...");
  await hre.upgrades.validateUpgrade(PROXY_ADDRESS, JackpotManagerV2, {
    kind: "uups",
  });
  console.log("Upgrade validation passed!");
  console.log("");

  console.log("Deploying new implementation and upgrading proxy...");
  const upgraded = await hre.upgrades.upgradeProxy(
    PROXY_ADDRESS,
    JackpotManagerV2
  );
  await upgraded.waitForDeployment();

  const newImplementation =
    await hre.upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);

  console.log("");
  console.log("=".repeat(60));
  console.log("JackpotManagerV2 upgraded successfully!");
  console.log("=".repeat(60));
  console.log("Proxy Address:", PROXY_ADDRESS);
  console.log("Old Implementation:", currentImplementation);
  console.log("New Implementation:", newImplementation);
  console.log("");

  // Verify MINIMUM_SEED is now 0.02 ETH
  const contract = await hre.ethers.getContractAt(
    "JackpotManagerV2",
    PROXY_ADDRESS
  );

  const minimumSeed = await contract.MINIMUM_SEED();
  const expectedSeed = hre.ethers.parseEther("0.02");
  console.log(
    "MINIMUM_SEED:",
    hre.ethers.formatEther(minimumSeed),
    "ETH"
  );

  if (minimumSeed === expectedSeed) {
    console.log("MINIMUM_SEED verified: 0.02 ETH");
  } else {
    console.error(
      "WARNING: MINIMUM_SEED mismatch! Expected 0.02 ETH, got",
      hre.ethers.formatEther(minimumSeed),
      "ETH"
    );
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
      ' "MINIMUM_SEED()(uint256)"'
  );
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
