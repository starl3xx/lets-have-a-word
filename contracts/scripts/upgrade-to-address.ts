/**
 * Upgrade Proxy to Specific Implementation
 *
 * Upgrades the JackpotManager proxy to a specific implementation address
 * without redeploying the implementation.
 *
 * Usage:
 *   IMPL_ADDRESS=0x9166977F2096524eb5704830EEd40900Be9c51ee npx hardhat run scripts/upgrade-to-address.ts --network base
 */

import hre from "hardhat";

const PROXY_ADDRESS = "0xfcb0D07a5BB5f004A1580D5Ae903E33c4A79EdB5";

async function main() {
  const newImplementation = process.env.IMPL_ADDRESS;

  if (!newImplementation) {
    throw new Error("Set IMPL_ADDRESS environment variable");
  }

  const [deployer] = await hre.ethers.getSigners();

  console.log("Upgrading JackpotManager proxy");
  console.log("Account:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("");
  console.log("Proxy:", PROXY_ADDRESS);
  console.log("New Implementation:", newImplementation);
  console.log("");

  // Get current implementation
  const currentImpl = await hre.upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
  console.log("Current Implementation:", currentImpl);
  console.log("");

  // Get the proxy contract with UUPSUpgradeable interface
  const proxy = await hre.ethers.getContractAt(
    ["function upgradeToAndCall(address newImplementation, bytes memory data) external"],
    PROXY_ADDRESS
  );

  console.log("Calling upgradeToAndCall...");
  const tx = await proxy.upgradeToAndCall(newImplementation, "0x");
  console.log("Transaction:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt?.blockNumber);
  console.log("");

  // Verify
  const newImpl = await hre.upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
  console.log("=".repeat(50));
  console.log("Upgrade complete!");
  console.log("Old Implementation:", currentImpl);
  console.log("New Implementation:", newImpl);
  console.log("=".repeat(50));

  if (newImpl.toLowerCase() !== newImplementation.toLowerCase()) {
    console.error("WARNING: Implementation address doesn't match expected!");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
