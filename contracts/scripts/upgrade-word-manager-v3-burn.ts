/**
 * Upgrade WordManagerV3 — Real ERC20 burn
 *
 * Replaces transfer-to-0xdead with ERC20Burnable.burn() so burns
 * reduce totalSupply() and aggregators reflect true circulating supply.
 *
 * Storage layout is unchanged — only function logic changes.
 *
 * Usage:
 *   npx hardhat run scripts/upgrade-word-manager-v3-burn.ts --network base
 */

import hre from "hardhat";

const PROXY_ADDRESS = "0x2eEa96E86D5b9e44E39A2A7D83CE214c6E10b574";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Upgrading WordManagerV3 with account:", deployer.address);
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

  // Deploy the new implementation directly
  console.log("Deploying new WordManagerV3 implementation...");
  const WordManagerV3 = await hre.ethers.getContractFactory("WordManagerV3");
  const newImpl = await WordManagerV3.deploy();
  await newImpl.waitForDeployment();
  const newImplAddress = await newImpl.getAddress();
  console.log("New Implementation deployed:", newImplAddress);
  console.log("");

  // Call upgradeToAndCall on the proxy
  console.log("Upgrading proxy to new implementation...");
  const proxy = await hre.ethers.getContractAt("WordManagerV3", PROXY_ADDRESS);
  const tx = await proxy.upgradeToAndCall(newImplAddress, "0x");
  console.log("Upgrade tx submitted:", tx.hash);
  const receipt = await tx.wait();
  console.log("Upgrade confirmed — block:", receipt!.blockNumber, "gas:", receipt!.gasUsed.toString());
  console.log("");

  // Verify the implementation changed
  const verifiedImpl =
    await hre.upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);

  console.log("=".repeat(60));
  console.log("WordManagerV3 upgraded successfully!");
  console.log("=".repeat(60));
  console.log("Proxy Address:", PROXY_ADDRESS);
  console.log("Old Implementation:", currentImplementation);
  console.log("New Implementation:", verifiedImpl);
  console.log("");

  if (verifiedImpl === currentImplementation) {
    console.log("WARNING: Implementation address did not change!");
  }

  // Post-upgrade verification
  const contract = await hre.ethers.getContractAt("WordManagerV3", PROXY_ADDRESS);

  console.log("Post-upgrade verification:");
  const totalBurned = await contract.totalBurned();
  const totalDistributed = await contract.totalDistributed();
  const totalStaked = await contract.totalStaked();
  const operator = await contract.operator();

  console.log("  - totalBurned:", hre.ethers.formatUnits(totalBurned, 18), "$WORD");
  console.log("  - totalDistributed:", hre.ethers.formatUnits(totalDistributed, 18), "$WORD");
  console.log("  - totalStaked:", hre.ethers.formatUnits(totalStaked, 18), "$WORD");
  console.log("  - operator:", operator);
  console.log("");

  console.log("Next steps:");
  console.log(`1. Verify implementation: npx hardhat verify --network ${hre.network.name} ${newImplAddress}`);
  console.log("2. Confirm burn works by checking next burn word claim tx");
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
