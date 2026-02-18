import hre from "hardhat";

const PROXY_ADDRESS = "0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5";
const ORIGINAL_OPERATOR = "0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38";

async function main() {
  const [owner] = await hre.ethers.getSigners();

  console.log("Starting Round 1...\n");

  const JackpotManager = await hre.ethers.getContractAt(
    "JackpotManager",
    PROXY_ADDRESS
  );

  // Verify minimum seed is met
  const isMinMet = await JackpotManager.isMinimumSeedMet();
  console.log("Minimum seed met:", isMinMet);

  if (!isMinMet) {
    console.log("ERROR: Minimum seed not met. Need 0.02 ETH.");
    return;
  }

  // Temporarily set owner as operator
  console.log("\nSetting owner as operator...");
  const tx1 = await JackpotManager.setOperatorWallet(owner.address);
  await tx1.wait();

  // Start the round
  console.log("Starting next round...");
  const tx2 = await JackpotManager.startNextRound();
  const receipt = await tx2.wait();
  console.log(`Transaction: ${tx2.hash}`);
  console.log(`Block: ${receipt?.blockNumber}`);

  // Restore original operator
  console.log("\nRestoring original operator...");
  const tx3 = await JackpotManager.setOperatorWallet(ORIGINAL_OPERATOR);
  await tx3.wait();

  // Show final state
  const [roundNumber, jackpot, isActive, startedAt] = await JackpotManager.getCurrentRoundInfo();

  console.log("\n" + "=".repeat(50));
  console.log("Round Started!");
  console.log("=".repeat(50));
  console.log(`  Round Number: ${roundNumber}`);
  console.log(`  Jackpot: ${hre.ethers.formatEther(jackpot)} ETH`);
  console.log(`  Is Active: ${isActive}`);
  console.log(`  Started At: ${new Date(Number(startedAt) * 1000).toISOString()}`);
}

main().catch(console.error);
