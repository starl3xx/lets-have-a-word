import hre from "hardhat";

const PROXY_ADDRESS = "0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5";

async function main() {
  const JackpotManager = await hre.ethers.getContractAt(
    "JackpotManager",
    PROXY_ADDRESS
  );

  console.log("=".repeat(50));
  console.log("JackpotManager Contract State");
  console.log("=".repeat(50));

  const [roundNumber, jackpot, isActive, startedAt] = await JackpotManager.getCurrentRoundInfo();

  console.log("\nRound Info:");
  console.log(`  Current Round: ${roundNumber}`);
  console.log(`  Jackpot: ${hre.ethers.formatEther(jackpot)} ETH`);
  console.log(`  Is Active: ${isActive}`);
  console.log(`  Started At: ${startedAt > 0n ? new Date(Number(startedAt) * 1000).toISOString() : 'N/A'}`);

  const balance = await hre.ethers.provider.getBalance(PROXY_ADDRESS);
  console.log(`\nContract Balance: ${hre.ethers.formatEther(balance)} ETH`);

  const marketCapInfo = await JackpotManager.getMarketCapInfo();
  console.log("\nMarket Cap Info:");
  console.log(`  Market Cap: $${(Number(marketCapInfo.marketCap) / 1e8).toLocaleString()}`);
  console.log(`  Tier: ${marketCapInfo.tier === 0n ? "LOW (2 guesses)" : "HIGH (3 guesses)"}`);
  console.log(`  Is Stale: ${marketCapInfo.isStale}`);

  console.log("\n" + "=".repeat(50));
}

main().catch(console.error);
