/**
 * Upgrade WordManagerV3 — deploy the solvency guards
 *
 * The live implementation (0x1156cA05…, the burn upgrade) predates the
 * gameSolvent guards from #161/#178 and the emergencyWithdraw guard: onchain,
 * every game payout and the owner's emergencyWithdraw can still spend staked
 * principal. This upgrade ships all three fixes. Storage layout is unchanged —
 * the guards compute from existing state.
 *
 * Uses the OZ plugin (upgradeProxy), not a direct upgradeToAndCall: the plugin
 * validates the storage layout against the manifest and records the new
 * implementation in .openzeppelin/, so no forceImport is needed afterwards.
 * Commit the manifest change this script makes.
 *
 * The signer must be the proxy owner (DEPLOYER_PRIVATE_KEY in contracts/.env).
 *
 * Usage:
 *   npx hardhat run scripts/upgrade-word-manager-v3-solvency.ts --network base
 *
 * Rehearsal against a different proxy (fork or Sepolia):
 *   WMV3_PROXY_ADDRESS=0x... npx hardhat run scripts/upgrade-word-manager-v3-solvency.ts --network <network>
 */

import hre from "hardhat";

const PROXY_ADDRESS =
  process.env.WMV3_PROXY_ADDRESS || "0x2eEa96E86D5b9e44E39A2A7D83CE214c6E10b574";

/**
 * Poll a read until it satisfies `predicate`. Base RPCs have served reads from
 * nodes that lag a just-confirmed write (see deploy-word-jackpot-sepolia.ts),
 * so a naive read-after-write can report the pre-upgrade implementation.
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
  const [signer] = await hre.ethers.getSigners();
  console.log("network:", hre.network.name);
  console.log("signer :", signer.address);
  console.log("proxy  :", PROXY_ADDRESS);
  console.log("");

  const oldImpl = await hre.upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
  console.log("current implementation:", oldImpl);

  const before = await hre.ethers.getContractAt("WordManagerV3", PROXY_ADDRESS);
  const stakedBefore: bigint = await before.totalStaked();
  console.log("totalStaked before    :", hre.ethers.formatUnits(stakedBefore, 18), "$WORD");
  console.log("");

  const WordManagerV3 = await hre.ethers.getContractFactory("WordManagerV3");

  console.log("validating storage layout against the manifest...");
  await hre.upgrades.validateUpgrade(PROXY_ADDRESS, WordManagerV3, { kind: "uups" });
  console.log("layout compatible.");
  console.log("");

  console.log("upgrading...");
  const proxy = await hre.upgrades.upgradeProxy(PROXY_ADDRESS, WordManagerV3);
  await proxy.waitForDeployment();

  const newImpl = await readUntil(
    () => hre.upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS),
    (impl) => impl.toLowerCase() !== oldImpl.toLowerCase(),
    "the implementation slot to change"
  );
  console.log("new implementation:", newImpl);
  console.log("");

  // --- Post-upgrade verification -----------------------------------------
  const manager = await hre.ethers.getContractAt("WordManagerV3", PROXY_ADDRESS);

  const staked: bigint = await manager.totalStaked();
  const reserved: bigint = await manager.reservedForStakers();
  const available: bigint = await manager.availableForGames();
  const operator: string = await manager.operator();

  console.log("totalStaked        :", hre.ethers.formatUnits(staked, 18), "$WORD");
  console.log("reservedForStakers :", hre.ethers.formatUnits(reserved, 18), "$WORD");
  console.log("availableForGames  :", hre.ethers.formatUnits(available, 18), "$WORD");
  console.log("operator           :", operator);
  console.log(
    staked === stakedBefore
      ? "staked principal unchanged across the upgrade"
      : "!! totalStaked CHANGED across the upgrade — investigate before anything else"
  );
  console.log("");

  // Free simulations — eth_call only, no state change, no gas.
  //
  // Probe with one wei MORE than the surplus: that amount is still inside the
  // token balance whenever the reserve is non-zero, so an unguarded
  // implementation would let the transfer through — only gameSolvent can
  // reject it. (One wei above the BALANCE would revert on the ERC20 transfer
  // itself and prove nothing.) The revert must also be the guard's own error:
  // 0x92f88c62 is the WouldTouchStakerFunds(uint256,uint256) selector, which
  // some tooling reports undecoded.
  if (reserved === 0n) {
    console.log("!! reserve is zero — the guard probe cannot distinguish guarded from unguarded here");
    process.exitCode = 1;
  }
  try {
    await manager.emergencyWithdraw.staticCall(signer.address, available + 1n);
    console.log("!! emergencyWithdraw beyond the surplus did NOT revert — guard is not live");
    process.exitCode = 1;
  } catch (error) {
    const msg = String(error);
    if (msg.includes("WouldTouchStakerFunds") || msg.includes("0x92f88c62")) {
      console.log("emergencyWithdraw beyond the surplus reverts WouldTouchStakerFunds (guard live)");
    } else {
      console.log("!! emergencyWithdraw beyond the surplus reverted for the WRONG reason:", msg.slice(0, 200));
      process.exitCode = 1;
    }
  }
  try {
    await manager.emergencyWithdraw.staticCall(signer.address, available);
    console.log("emergencyWithdraw within the surplus simulates fine");
  } catch (error) {
    console.log("!! emergencyWithdraw within the surplus reverted:", String(error).slice(0, 200));
    process.exitCode = 1;
  }
  console.log("");

  console.log("next steps:");
  console.log(`1. commit the .openzeppelin manifest update`);
  console.log(`2. npx hardhat verify --network ${hre.network.name} ${newImpl}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
