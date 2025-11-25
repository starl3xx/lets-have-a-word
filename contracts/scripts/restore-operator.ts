import hre from "hardhat";

const PROXY_ADDRESS = "0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5";
const ORIGINAL_OPERATOR = "0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38";

async function main() {
  const JackpotManager = await hre.ethers.getContractAt(
    "JackpotManager",
    PROXY_ADDRESS
  );

  const currentOperator = await JackpotManager.operatorWallet();
  console.log("Current operator:", currentOperator);

  if (currentOperator.toLowerCase() === ORIGINAL_OPERATOR.toLowerCase()) {
    console.log("Operator is already correct!");
    return;
  }

  console.log("Restoring operator to:", ORIGINAL_OPERATOR);
  const tx = await JackpotManager.setOperatorWallet(ORIGINAL_OPERATOR);
  await tx.wait();

  console.log("Operator restored!");
  console.log("New operator:", await JackpotManager.operatorWallet());
}

main().catch(console.error);
