/**
 * Deploy the round-34 $WORD-era contracts to Base mainnet:
 *
 *   WordJackpot   — UUPS proxy; holds the $WORD prize pool, carry, claims
 *   WordPackSales — plain; takes ETH for packs/Superguesses, treasury-locked
 *   GuessLog      — plain; operator posts Merkle checkpoints of guesses
 *
 * The proxy is deployed explicitly (impl + ERC1967Proxy) and then registered
 * with forceImport, the pattern proven by deploy-word-jackpot-sepolia.ts:
 * deployProxy's immediate slot read can race a lagging RPC node, while this
 * path is deterministic and still leaves the manifest correct. Commit the
 * .openzeppelin/base.json change this script makes.
 *
 * The signer (DEPLOYER_PRIVATE_KEY in contracts/.env) becomes owner of
 * WordJackpot and GuessLog. WordPackSales has no owner — its treasury is
 * immutable and withdraw() is permissionless.
 *
 * After deployment, the launch sequence continues OFF this script:
 *   1. Vercel env: WORD_JACKPOT_ADDRESS, WORD_PACK_SALES_ADDRESS,
 *      NEXT_PUBLIC_WORD_PACK_SALES_ADDRESS, GUESS_LOG_ADDRESS (+ redeploy)
 *   2. Fund the tranche from the treasury (hand-signed: approve + fund)
 *   3. Basescan verification (commands printed below)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-word-round34-contracts.ts --network base
 */

import hre from "hardhat";

// Production constants — same roles as JackpotManagerV3 (DEPLOYMENT_SUMMARY.md)
const WORD_TOKEN = "0x304e649e69979298BD1AEE63e175ADf07885fb4b";
const OPERATOR = "0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38"; // server signer
const TREASURY = "0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB"; // letshaveaword.eth

/** Poll a read until it satisfies `predicate` — Base RPCs can lag a write. */
async function readUntil<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  what: string,
  attempts = 15
): Promise<T> {
  let last: T = await read();
  for (let i = 0; i < attempts; i++) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 2000));
    last = await read();
  }
  throw new Error(`Timed out waiting for ${what} (last value: ${String(last)})`);
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok " : "!! "} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("network :", hre.network.name);
  console.log("deployer:", deployer.address);
  console.log(
    "balance :",
    hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)),
    "ETH"
  );
  console.log("");

  // --- WordJackpot (UUPS proxy) ------------------------------------------
  const Jackpot = await hre.ethers.getContractFactory("WordJackpot");
  const impl = await Jackpot.deploy();
  await impl.waitForDeployment();
  const implAddress = await impl.getAddress();
  console.log("WordJackpot impl :", implAddress);

  const initData = Jackpot.interface.encodeFunctionData("initialize", [
    WORD_TOKEN,
    OPERATOR,
    TREASURY,
  ]);
  const Proxy = await hre.ethers.getContractFactory("ERC1967Proxy");
  const proxy = await Proxy.deploy(implAddress, initData);
  await proxy.deploymentTransaction()?.wait(2);
  const jackpotAddress = await proxy.getAddress();
  console.log("WordJackpot proxy:", jackpotAddress);

  await readUntil(
    () => hre.upgrades.erc1967.getImplementationAddress(jackpotAddress),
    (v) => v.toLowerCase() === implAddress.toLowerCase(),
    "the proxy's implementation slot"
  );
  await hre.upgrades.forceImport(jackpotAddress, Jackpot, { kind: "uups" });
  console.log("registered in the OZ manifest via forceImport");
  console.log("");

  // --- WordPackSales ------------------------------------------------------
  const PackSales = await hre.ethers.getContractFactory("WordPackSales");
  const packSales = await PackSales.deploy(TREASURY);
  await packSales.deploymentTransaction()?.wait(2);
  const packSalesAddress = await packSales.getAddress();
  console.log("WordPackSales    :", packSalesAddress);

  // --- GuessLog -----------------------------------------------------------
  const GuessLog = await hre.ethers.getContractFactory("GuessLog");
  const guessLog = await GuessLog.deploy(OPERATOR);
  await guessLog.deploymentTransaction()?.wait(2);
  const guessLogAddress = await guessLog.getAddress();
  console.log("GuessLog         :", guessLogAddress);
  console.log("");

  // --- Post-deploy sanity: every role reads back as configured ------------
  const jackpot = Jackpot.attach(jackpotAddress) as any;
  check("WordJackpot.wordToken", (await jackpot.wordToken()).toLowerCase() === WORD_TOKEN.toLowerCase());
  check("WordJackpot.operator", (await jackpot.operator()).toLowerCase() === OPERATOR.toLowerCase());
  check("WordJackpot.treasury", (await jackpot.treasury()).toLowerCase() === TREASURY.toLowerCase());
  check("WordJackpot.owner = deployer", (await jackpot.owner()).toLowerCase() === deployer.address.toLowerCase());
  check("WordPackSales.treasury", (await (packSales as any).treasury()).toLowerCase() === TREASURY.toLowerCase());
  check("GuessLog.operator", (await (guessLog as any).operator()).toLowerCase() === OPERATOR.toLowerCase());
  check("GuessLog.owner = deployer", (await (guessLog as any).owner()).toLowerCase() === deployer.address.toLowerCase());
  console.log("");
  console.log(failures === 0 ? "ALL ROLES CORRECT" : `!! ${failures} role check(s) failed — do not proceed`);
  if (failures > 0) process.exitCode = 1;

  console.log("");
  console.log("=".repeat(60));
  console.log("Vercel env (then redeploy):");
  console.log(`  WORD_JACKPOT_ADDRESS=${jackpotAddress}`);
  console.log(`  WORD_PACK_SALES_ADDRESS=${packSalesAddress}`);
  console.log(`  NEXT_PUBLIC_WORD_PACK_SALES_ADDRESS=${packSalesAddress}`);
  console.log(`  GUESS_LOG_ADDRESS=${guessLogAddress}`);
  console.log("");
  console.log("Basescan verification:");
  console.log(`  npx hardhat verify --network base ${implAddress}`);
  console.log(`  npx hardhat verify --network base ${jackpotAddress} ${implAddress} ${initData}`);
  console.log(`  npx hardhat verify --network base ${packSalesAddress} ${TREASURY}`);
  console.log(`  npx hardhat verify --network base ${guessLogAddress} ${OPERATOR}`);
  console.log("");
  console.log("Tranche funding (hand-signed from the treasury):");
  console.log(`  1. $WORD.approve(${jackpotAddress}, tranche)`);
  console.log(`  2. WordJackpot.fund(tranche)  — credits unallocated, not the pool`);
  console.log("");
  console.log("And commit the .openzeppelin/base.json update.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
