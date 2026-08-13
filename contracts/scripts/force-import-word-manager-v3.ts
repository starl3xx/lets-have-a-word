/**
 * Force-import WordManagerV3 into the OpenZeppelin manifest
 *
 * The burn upgrade was deployed by scripts/upgrade-word-manager-v3-burn.ts,
 * which calls upgradeToAndCall() directly rather than going through
 * upgrades.upgradeProxy(). The plugin therefore never recorded the live
 * implementation, so .openzeppelin/base.json still points at the previous
 * one and any plugin-driven upgrade fails with
 * "Deployment at address ... is not registered".
 *
 * forceImport re-registers the proxy and its CURRENT implementation, taking
 * the storage layout from the local WordManagerV3 source. That is only
 * correct if the local source matches what is deployed — verified: compiling
 * this source reproduces the deployed runtime bytecode exactly, differing
 * only in the three UUPS __self immutables.
 *
 * Read-only on chain: reads the ERC-1967 implementation slot and bytecode,
 * sends no transaction and spends no gas. It only rewrites the local manifest.
 *
 * Usage:
 *   npx hardhat run scripts/force-import-word-manager-v3.ts --network base
 */

import hre from "hardhat";

const PROXY_ADDRESS = "0x2eEa96E86D5b9e44E39A2A7D83CE214c6E10b574";

async function main() {
  console.log("Network:", hre.network.name);
  console.log("Proxy:  ", PROXY_ADDRESS);
  console.log("");

  const liveImpl = await hre.upgrades.erc1967.getImplementationAddress(
    PROXY_ADDRESS
  );
  console.log("Live implementation:", liveImpl);

  const WordManagerV3 = await hre.ethers.getContractFactory("WordManagerV3");

  console.log("Force-importing into the manifest...");
  await hre.upgrades.forceImport(PROXY_ADDRESS, WordManagerV3, {
    kind: "uups",
  });

  console.log("");
  console.log("Done. Verifying the manifest now resolves the live impl...");

  // validateUpgrade throws if the manifest cannot resolve the current
  // implementation's layout, which is exactly what was broken before.
  await hre.upgrades.validateUpgrade(PROXY_ADDRESS, WordManagerV3, {
    kind: "uups",
  });

  console.log("validateUpgrade passed — layout is registered and compatible.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
