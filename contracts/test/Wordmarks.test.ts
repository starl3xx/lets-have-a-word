import { expect } from "chai";
import hre from "hardhat";

/**
 * Wordmarks tests.
 *
 * Written against the four ways a voucher-gated mint goes wrong, because every
 * one of them is silent: nothing reverts at the point the mistake is made, and
 * you find out when somebody holds a Wordmark they did not earn.
 *
 *   1. A voucher redeemed by somebody other than its subject.
 *   2. One player minting the same Wordmark once per wallet they control,
 *      which is not hypothetical here — user_addresses exists precisely
 *      because a Farcaster EOA and a Base Account are different wallets.
 *   3. A voucher signed by anything other than the attestor.
 *   4. An achievement becoming a tradeable collectible.
 */

const EARLY_ADOPTER = 10n;
const TRAILBLAZER = 11n;
const FID = 6500n;

describe("Wordmarks", function () {
  async function deploy() {
    const [owner, attestor, player, otherPlayer, impostor] = await hre.ethers.getSigners();

    const Wordmarks = await hre.ethers.getContractFactory("Wordmarks");
    const wordmarks = await Wordmarks.deploy(
      owner.address,
      attestor.address,
      "https://www.letshaveaword.fun/api/wordmarks/metadata/"
    );
    await wordmarks.waitForDeployment();

    const deadline = BigInt((await hre.ethers.provider.getBlock("latest"))!.timestamp) + 3600n;

    const domain = {
      name: "LetsHaveAWordWordmarks",
      version: "1",
      chainId: (await hre.ethers.provider.getNetwork()).chainId,
      verifyingContract: await wordmarks.getAddress(),
    };
    const types = {
      Claim: [
        { name: "fid", type: "uint256" },
        { name: "to", type: "address" },
        { name: "id", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const sign = (signer: any, fid: bigint, to: string, id: bigint, dl: bigint = deadline) =>
      signer.signTypedData(domain, types, { fid, to, id, deadline: dl });

    return { wordmarks, owner, attestor, player, otherPlayer, impostor, deadline, sign };
  }

  it("mints to the attested address, and the PLAYER is the sender", async function () {
    const { wordmarks, attestor, player, deadline, sign } = await deploy();
    const sig = await sign(attestor, FID, player.address, EARLY_ADOPTER);

    // Sent by the player, not the house. This is the entire point: an airdrop
    // from the operator wallet would be one transacting address, not 4,029.
    const tx = await wordmarks.connect(player).mint(FID, player.address, EARLY_ADOPTER, deadline, sig);
    const receipt = await tx.wait();

    expect(receipt!.from).to.equal(player.address);
    expect(await wordmarks.balanceOf(player.address, EARLY_ADOPTER)).to.equal(1n);
  });

  it("refuses a voucher lifted from another player's response", async function () {
    const { wordmarks, attestor, player, impostor, deadline, sign } = await deploy();
    // Issued for `player`, and the impostor got hold of it.
    const sig = await sign(attestor, FID, player.address, EARLY_ADOPTER);

    // Redeeming it to themselves fails: `to` is inside the signed payload.
    await expect(
      wordmarks.connect(impostor).mint(FID, impostor.address, EARLY_ADOPTER, deadline, sig)
    ).to.be.revertedWithCustomError(wordmarks, "BadSignature");

    // Submitting it verbatim mints to the rightful owner, not the sender.
    // The impostor can only pay somebody else's gas.
    await wordmarks.connect(impostor).mint(FID, player.address, EARLY_ADOPTER, deadline, sig);
    expect(await wordmarks.balanceOf(impostor.address, EARLY_ADOPTER)).to.equal(0n);
    expect(await wordmarks.balanceOf(player.address, EARLY_ADOPTER)).to.equal(1n);
  });

  it("lets one fid mint a Wordmark once, across every wallet it controls", async function () {
    const { wordmarks, attestor, player, otherPlayer, deadline, sign } = await deploy();

    await wordmarks
      .connect(player)
      .mint(FID, player.address, EARLY_ADOPTER, deadline, await sign(attestor, FID, player.address, EARLY_ADOPTER));

    // Same player, second proven wallet, a freshly and correctly signed
    // voucher. Keyed on the address this would mint a second one.
    await expect(
      wordmarks
        .connect(otherPlayer)
        .mint(FID, otherPlayer.address, EARLY_ADOPTER, deadline, await sign(attestor, FID, otherPlayer.address, EARLY_ADOPTER))
    ).to.be.revertedWithCustomError(wordmarks, "AlreadyMinted");

    // A DIFFERENT Wordmark still mints. The guard is per achievement.
    await wordmarks
      .connect(player)
      .mint(FID, player.address, TRAILBLAZER, deadline, await sign(attestor, FID, player.address, TRAILBLAZER));
    expect(await wordmarks.balanceOf(player.address, TRAILBLAZER)).to.equal(1n);
  });

  it("refuses a self-signed voucher", async function () {
    const { wordmarks, player, impostor, deadline, sign } = await deploy();
    await expect(
      wordmarks
        .connect(player)
        .mint(FID, player.address, EARLY_ADOPTER, deadline, await sign(impostor, FID, player.address, EARLY_ADOPTER))
    ).to.be.revertedWithCustomError(wordmarks, "BadSignature");
  });

  it("refuses an expired voucher", async function () {
    const { wordmarks, attestor, player, sign } = await deploy();
    const past = BigInt((await hre.ethers.provider.getBlock("latest"))!.timestamp) - 1n;
    await expect(
      wordmarks
        .connect(player)
        .mint(FID, player.address, EARLY_ADOPTER, past, await sign(attestor, FID, player.address, EARLY_ADOPTER, past))
    ).to.be.revertedWithCustomError(wordmarks, "VoucherExpired");
  });

  it("cannot be sold, but can be burned", async function () {
    const { wordmarks, attestor, player, otherPlayer, deadline, sign } = await deploy();
    await wordmarks
      .connect(player)
      .mint(FID, player.address, EARLY_ADOPTER, deadline, await sign(attestor, FID, player.address, EARLY_ADOPTER));

    await expect(
      wordmarks
        .connect(player)
        .safeTransferFrom(player.address, otherPlayer.address, EARLY_ADOPTER, 1n, "0x")
    ).to.be.revertedWithCustomError(wordmarks, "Soulbound");

    // Walking away is still allowed. An achievement you cannot refuse is a tag.
    // This needs ERC1155Burnable: safeTransferFrom to the zero address reverts
    // inside ERC-1155 before _update is reached, so burn() is the only route
    // and the first version of this test proved nothing by going that way.
    await wordmarks.connect(player).burn(player.address, EARLY_ADOPTER, 1n);
    expect(await wordmarks.balanceOf(player.address, EARLY_ADOPTER)).to.equal(0n);
  });

  it("does not let a burn be used to re-mint", async function () {
    const { wordmarks, attestor, player, deadline, sign } = await deploy();
    const voucher = await sign(attestor, FID, player.address, EARLY_ADOPTER);

    await wordmarks.connect(player).mint(FID, player.address, EARLY_ADOPTER, deadline, voucher);
    await wordmarks.connect(player).burn(player.address, EARLY_ADOPTER, 1n);

    // mintedByFid survives the burn deliberately. Otherwise burn-and-remint is
    // an unlimited supply of the same achievement.
    await expect(
      wordmarks.connect(player).mint(FID, player.address, EARLY_ADOPTER, deadline, voucher)
    ).to.be.revertedWithCustomError(wordmarks, "AlreadyMinted");
  });

  it("rotates the attestor without touching anything else", async function () {
    const { wordmarks, owner, attestor, player, impostor, deadline, sign } = await deploy();
    await wordmarks.connect(owner).setAttestor(impostor.address);

    await expect(
      wordmarks
        .connect(player)
        .mint(FID, player.address, EARLY_ADOPTER, deadline, await sign(attestor, FID, player.address, EARLY_ADOPTER))
    ).to.be.revertedWithCustomError(wordmarks, "BadSignature");

    await wordmarks
      .connect(player)
      .mint(FID, player.address, EARLY_ADOPTER, deadline, await sign(impostor, FID, player.address, EARLY_ADOPTER));
    expect(await wordmarks.balanceOf(player.address, EARLY_ADOPTER)).to.equal(1n);
  });

  it("serves per-token metadata, since ERC-1155 leaves {id} to the client", async function () {
    const { wordmarks } = await deploy();
    expect(await wordmarks.uri(EARLY_ADOPTER)).to.equal(
      "https://www.letshaveaword.fun/api/wordmarks/metadata/10.json"
    );
  });
});
