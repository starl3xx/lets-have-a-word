/**
 * Push Market Cap Script (Using Owner)
 * Temporarily sets deployer as operator, pushes market cap, restores operator
 */

import hre from "hardhat";

const PROXY_ADDRESS = "0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5";
const ORIGINAL_OPERATOR = "0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38";

async function main() {
  const [owner] = await hre.ethers.getSigners();

  console.log("Using owner account:", owner.address);
  console.log(
    "Balance:",
    hre.ethers.formatEther(await hre.ethers.provider.getBalance(owner.address)),
    "ETH\n"
  );

  // Get contract
  const JackpotManager = await hre.ethers.getContractAt(
    "JackpotManager",
    PROXY_ADDRESS
  );

  // Verify we're the owner
  const contractOwner = await JackpotManager.owner();
  if (contractOwner.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error("Signer is not the owner!");
  }

  // Set initial market cap ($150,000 - below threshold for LOW tier)
  const marketCapUsd = 150_000;
  const marketCapScaled = BigInt(Math.floor(marketCapUsd * 1e8));

  console.log(`Setting market cap: $${marketCapUsd.toLocaleString()}`);
  console.log(`Scaled value: ${marketCapScaled.toString()}`);

  // Step 1: Temporarily set owner as operator
  console.log("\nStep 1: Setting owner as operator...");
  const tx1 = await JackpotManager.setOperatorWallet(owner.address);
  await tx1.wait();
  console.log("Owner is now operator");

  // Step 2: Push market cap
  console.log("\nStep 2: Pushing market cap...");
  const tx2 = await JackpotManager.updateClanktonMarketCap(marketCapScaled);
  console.log(`Transaction hash: ${tx2.hash}`);
  const receipt = await tx2.wait();
  console.log(`Confirmed in block: ${receipt?.blockNumber}`);

  // Step 3: Restore original operator
  console.log("\nStep 3: Restoring original operator...");
  const tx3 = await JackpotManager.setOperatorWallet(ORIGINAL_OPERATOR);
  await tx3.wait();
  console.log(`Operator restored to: ${ORIGINAL_OPERATOR}`);

  // Check final state
  const info = await JackpotManager.getMarketCapInfo();
  console.log("\nFinal state:");
  console.log(`  Market Cap: $${(Number(info.marketCap) / 1e8).toLocaleString()}`);
  console.log(`  Tier: ${info.tier === 0n ? "LOW" : "HIGH"}`);
  console.log(`  Is Stale: ${info.isStale}`);
  console.log(`  Free Guesses: ${await JackpotManager.getFreeGuessesForTier()}`);
  console.log(`  Operator: ${await JackpotManager.operatorWallet()}`);
}

main().catch(console.error);
