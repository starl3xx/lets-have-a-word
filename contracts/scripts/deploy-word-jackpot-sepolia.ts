/**
 * Deploy WordJackpot to Base Sepolia and drive a full round end to end.
 *
 * The in-process Hardhat network proves the logic; this proves it against a
 * real chain — real proxy deployment through the OZ plugin, real gas, real
 * block timestamps for the price-staleness check.
 *
 * Deploys its own MockWordToken because $WORD only exists on mainnet.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-word-jackpot-sepolia.ts --network baseSepolia
 */
import hre from "hardhat";

const E18 = 10n ** 18n;
const PRICE_E18 = 256_000_000_000n; // $0.000000256 per $WORD
const SEED_CENTS = 2000n; // $20
const TRANCHE = 5_000_000_000n * E18;

/**
 * Poll a contract read until it satisfies `predicate`.
 *
 * Needed because this RPC can serve a read from a node that has not yet caught
 * up with a write we just confirmed, so read-after-write silently returns the
 * old value.
 */
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

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("network :", hre.network.name);
  console.log("deployer:", deployer.address);
  console.log("");

  // --- Mock token -------------------------------------------------------
  const Token = await hre.ethers.getContractFactory("MockWordToken");
  const token = await Token.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("MockWordToken:", tokenAddress);

  // --- WordJackpot proxy ------------------------------------------------
  const Jackpot = await hre.ethers.getContractFactory("WordJackpot");
  // Deploy the implementation and proxy explicitly rather than via
  // upgrades.deployProxy.
  //
  // deployProxy reads the ERC-1967 implementation slot immediately after
  // deploying the proxy, and against this RPC that read comes back empty — it
  // then reports "doesn't look like an ERC 1967 proxy" even though the proxy
  // deployed correctly (verified onchain: the slot IS populated moments
  // later). Doing it explicitly and registering with forceImport afterwards is
  // deterministic, and unlike the direct upgradeToAndCall pattern used
  // elsewhere in this repo it still leaves the manifest correct.
  const impl = await Jackpot.deploy();
  await impl.waitForDeployment();
  const implAddress = await impl.getAddress();
  console.log("WordJackpot impl deployed:", implAddress);

  const initData = Jackpot.interface.encodeFunctionData("initialize", [
    tokenAddress,
    deployer.address,
    deployer.address,
  ]);
  const Proxy = await hre.ethers.getContractFactory("ERC1967Proxy");
  const proxy = await Proxy.deploy(implAddress, initData);
  await proxy.waitForDeployment();
  const jackpotAddress = await proxy.getAddress();

  // Give the RPC a moment to make the deployment readable, then register the
  // proxy so future plugin-driven upgrades validate against a correct layout.
  await proxy.deploymentTransaction()?.wait(2);
  await hre.upgrades.forceImport(jackpotAddress, Jackpot, { kind: "uups" });
  console.log("registered in the OZ manifest via forceImport");

  const jackpot = Jackpot.attach(jackpotAddress) as any;
  console.log("WordJackpot proxy :", jackpotAddress);
  console.log("WordJackpot impl  :", implAddress);
  console.log("");

  // --- Fund the tranche -------------------------------------------------
  await (await token.mint(deployer.address, TRANCHE)).wait(2);
  await (await token.approve(jackpotAddress, TRANCHE)).wait(2);
  await (await jackpot.fund(TRANCHE)).wait(2);
  console.log("funded tranche:", hre.ethers.formatUnits(TRANCHE, 18), "$WORD");

  // --- Price + round start ----------------------------------------------
  await (await jackpot.setWordPrice(PRICE_E18)).wait(2);
  await readUntil(
    () => jackpot.priceE18(),
    (v: bigint) => v === PRICE_E18,
    "the price write to be visible"
  );

  const expectedSeed = await jackpot.seedTokensFor(SEED_CENTS);
  console.log("seed for $20  :", hre.ethers.formatUnits(expectedSeed, 18), "$WORD");

  const commitHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("sepolia-round-34"));
  await (await jackpot.startRound(34, SEED_CENTS, commitHash)).wait(2);
  const startedPool = await readUntil(
    () => jackpot.pool(),
    (v: bigint) => v === expectedSeed,
    "the round seed to be visible"
  );
  console.log("round 34 started, pool:", hre.ethers.formatUnits(startedPool, 18));

  // --- Simulate pack revenue --------------------------------------------
  // Reuse the value readUntil already confirmed rather than reading again: a
  // fresh read here can be served by a lagging node and return the pre-seed
  // value, which would make the wait below poll for the wrong total and time
  // out even though the top-up landed.
  const poolBefore: bigint = startedPool;
  const topUp = 20_000_000n * E18;
  await (await jackpot.topUpPool(topUp)).wait(2);

  // This RPC serves reads from nodes that can lag a just-mined write, so a
  // naive read-after-write returns the pre-transaction value. That is not
  // cosmetic here: the payout split is computed from `pool`, and a stale read
  // produces amounts that fail the contract's exact-sum check. Poll until the
  // node agrees with what we just wrote.
  const pool = await readUntil(
    () => jackpot.pool(),
    (v: bigint) => v === poolBefore + topUp,
    "pool to reflect the top-up"
  );
  console.log("after top-up  :", hre.ethers.formatUnits(pool, 18));
  console.log("");

  // --- Resolve with the real 80/10/5/5 split ----------------------------
  const wallets = [
    hre.ethers.Wallet.createRandom().address,
    hre.ethers.Wallet.createRandom().address,
    hre.ethers.Wallet.createRandom().address,
  ];
  const toWinner = (pool * 8000n) / 10000n;
  const toTop10 = (pool * 1000n) / 10000n;
  const toReferrer = (pool * 500n) / 10000n;
  const carryNext = pool - toWinner - toTop10 - toReferrer;

  await (
    await jackpot.resolveRound(34, wallets, [toWinner, toTop10, toReferrer], carryNext)
  ).wait(2);

  console.log("winner   :", hre.ethers.formatUnits(await token.balanceOf(wallets[0]), 18));
  console.log("top10    :", hre.ethers.formatUnits(await token.balanceOf(wallets[1]), 18));
  console.log("referrer :", hre.ethers.formatUnits(await token.balanceOf(wallets[2]), 18));
  console.log("carry    :", hre.ethers.formatUnits(await jackpot.carry(), 18));
  console.log("pool     :", hre.ethers.formatUnits(await jackpot.pool(), 18));
  console.log("");

  // --- Invariant --------------------------------------------------------
  const [balance, pool_, carry_, claimable_, unallocated_] = await jackpot.solvency();
  const committed = pool_ + carry_ + claimable_;
  console.log("solvency: balance", hre.ethers.formatUnits(balance, 18));
  console.log("          committed", hre.ethers.formatUnits(committed, 18));
  console.log("          unallocated", hre.ethers.formatUnits(unallocated_, 18));
  console.log(balance >= committed ? "INVARIANT HOLDS" : "INVARIANT VIOLATED");

  console.log("");
  console.log("=".repeat(56));
  console.log("WordJackpot proxy:", jackpotAddress);
  console.log("MockWordToken    :", tokenAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
