/**
 * Print the connected network, deployer and balance.
 *
 * Usage: npx hardhat run scripts/check-network.ts --network baseSepolia
 */
import hre from "hardhat";

async function main() {
  const net = await hre.ethers.provider.getNetwork();
  const signers = await hre.ethers.getSigners();

  console.log("network :", hre.network.name, "| chainId", net.chainId.toString());
  console.log("block   :", await hre.ethers.provider.getBlockNumber());

  if (signers.length === 0) {
    console.log("deployer: none configured (DEPLOYER_PRIVATE_KEY unset for this network)");
    return;
  }

  const deployer = signers[0];
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("deployer:", deployer.address);
  console.log("balance :", hre.ethers.formatEther(balance), "ETH");
  console.log(balance > 0n ? "=> funded, can deploy" : "=> NO testnet ETH, cannot deploy");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
