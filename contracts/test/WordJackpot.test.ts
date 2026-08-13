import { expect } from "chai";
import hre from "hardhat";

/**
 * WordJackpot tests.
 *
 * Written against the failure modes that have no coverage anywhere in this
 * repo today: the payout batch itself, a recipient that reverts, exact-sum
 * accounting at 18 decimals, and the sweep boundary. JackpotManagerV3's
 * equivalent path (resolveRoundWithPayouts) has never been tested.
 */

const E18 = 10n ** 18n;

// $0.000000256 per token => priceE18 = 2.56e11
const PRICE_E18 = 256_000_000_000n;
const SEED_CENTS = 2000n; // $20

describe("WordJackpot", function () {
  async function deploy() {
    const [owner, operator, treasury, winner, second, third] = await hre.ethers.getSigners();

    const Token = await hre.ethers.getContractFactory("MockWordToken");
    const token = await Token.deploy();
    await token.waitForDeployment();

    const Jackpot = await hre.ethers.getContractFactory("WordJackpot");
    const jackpot = await hre.upgrades.deployProxy(
      Jackpot,
      [await token.getAddress(), operator.address, treasury.address],
      { initializer: "initialize", kind: "uups" }
    );
    await jackpot.waitForDeployment();

    // Fund a tranche
    const tranche = 5_000_000_000n * E18;
    await token.mint(owner.address, tranche);
    await token.approve(await jackpot.getAddress(), tranche);
    await jackpot.fund(tranche);

    await jackpot.connect(operator).setWordPrice(PRICE_E18);

    return { jackpot, token, owner, operator, treasury, winner, second, third, tranche };
  }

  describe("seed pricing", function () {
    it("converts USD cents to tokens at the stored price", async function () {
      const { jackpot } = await deploy();
      // 2000 * 1e34 / 2.56e11 = 7.8125e25 = 78,125,000 tokens
      expect(await jackpot.seedTokensFor(SEED_CENTS)).to.equal(78_125_000n * E18);
    });

    it("computes the seed itself rather than trusting a caller-supplied amount", async function () {
      const { jackpot, operator } = await deploy();
      await jackpot.connect(operator).startRound(34, SEED_CENTS, hre.ethers.ZeroHash);
      expect(await jackpot.pool()).to.equal(78_125_000n * E18);
    });

    it("refuses to start on a stale price", async function () {
      const { jackpot, operator } = await deploy();
      await hre.network.provider.send("evm_increaseTime", [3 * 60 * 60]); // > 2h
      await hre.network.provider.send("evm_mine");
      await expect(
        jackpot.connect(operator).startRound(34, SEED_CENTS, hre.ethers.ZeroHash)
      ).to.be.revertedWithCustomError(jackpot, "PriceStale");
    });

    it("rejects a seed outside the configured bounds", async function () {
      const { jackpot, operator } = await deploy();
      // A price crash makes a fixed USD seed cost far more tokens
      await jackpot.connect(operator).setWordPrice(1_000_000n); // absurdly low
      await expect(
        jackpot.connect(operator).startRound(34, SEED_CENTS, hre.ethers.ZeroHash)
      ).to.be.revertedWithCustomError(jackpot, "SeedOutOfBounds");
    });
  });

  describe("accounting", function () {
    it("never counts pool, carry or claims as unallocated", async function () {
      const { jackpot, operator, tranche } = await deploy();
      expect(await jackpot.unallocated()).to.equal(tranche);

      await jackpot.connect(operator).startRound(34, SEED_CENTS, hre.ethers.ZeroHash);
      const seed = 78_125_000n * E18;
      expect(await jackpot.unallocated()).to.equal(tranche - seed);
      expect(await jackpot.pool()).to.equal(seed);
    });

    it("consumes carry before the tranche on the next round", async function () {
      const { jackpot, operator, winner } = await deploy();
      const seed = 78_125_000n * E18;

      await jackpot.connect(operator).startRound(34, SEED_CENTS, hre.ethers.ZeroHash);
      // Resolve leaving a carry equal to a full next seed
      await jackpot
        .connect(operator)
        .resolveRound(34, [winner.address], [seed - seed / 2n], seed / 2n);
      expect(await jackpot.carry()).to.equal(seed / 2n);

      const before = await jackpot.unallocated();
      await jackpot.connect(operator).startRound(35, SEED_CENTS, hre.ethers.ZeroHash);
      // Half the seed came from carry, so only half was drawn from the tranche
      expect(await jackpot.carry()).to.equal(0n);
      expect(await jackpot.unallocated()).to.equal(before - seed / 2n);
    });

    it("sweepUnallocated cannot touch committed funds", async function () {
      const { jackpot, owner, operator, treasury } = await deploy();
      await jackpot.connect(operator).startRound(34, SEED_CENTS, hre.ethers.ZeroHash);

      const available = await jackpot.unallocated();
      await expect(
        jackpot.connect(owner).sweepUnallocated(treasury.address, available + 1n)
      ).to.be.revertedWithCustomError(jackpot, "InsufficientUnallocated");

      await jackpot.connect(owner).sweepUnallocated(treasury.address, available);
      expect(await jackpot.unallocated()).to.equal(0n);
      // The live round's pool survived the sweep
      expect(await jackpot.pool()).to.equal(78_125_000n * E18);
    });
  });

  describe("resolveRound", function () {
    it("requires payouts plus carry to equal the pool exactly", async function () {
      const { jackpot, operator, winner } = await deploy();
      await jackpot.connect(operator).startRound(34, SEED_CENTS, hre.ethers.ZeroHash);
      const seed = 78_125_000n * E18;

      await expect(
        jackpot.connect(operator).resolveRound(34, [winner.address], [seed - 1n], 0n)
      ).to.be.revertedWithCustomError(jackpot, "PayoutMismatch");

      await expect(jackpot.connect(operator).resolveRound(34, [winner.address], [seed], 0n)).to.not
        .be.reverted;
    });

    it("pays the 80/10/5/5 split", async function () {
      const { jackpot, token, operator, winner, second, third } = await deploy();
      await jackpot.connect(operator).startRound(34, SEED_CENTS, hre.ethers.ZeroHash);
      const seed = 78_125_000n * E18;

      const toWinner = (seed * 8000n) / 10000n;
      const toTop10 = (seed * 1000n) / 10000n;
      const toReferrer = (seed * 500n) / 10000n;
      const carryNext = seed - toWinner - toTop10 - toReferrer;

      await jackpot
        .connect(operator)
        .resolveRound(
          34,
          [winner.address, second.address, third.address],
          [toWinner, toTop10, toReferrer],
          carryNext
        );

      expect(await token.balanceOf(winner.address)).to.equal(toWinner);
      expect(await token.balanceOf(second.address)).to.equal(toTop10);
      expect(await token.balanceOf(third.address)).to.equal(toReferrer);
      expect(await jackpot.carry()).to.equal(carryNext);
      expect(await jackpot.pool()).to.equal(0n);
    });

    it("a reverting recipient becomes a claim instead of bricking the batch", async function () {
      const { jackpot, token, operator, winner } = await deploy();

      const Rejector = await hre.ethers.getContractFactory("RejectingReceiver");
      const rejector = await Rejector.deploy(await token.getAddress());
      await rejector.waitForDeployment();
      await token.setBlocked(await rejector.getAddress(), true);

      await jackpot.connect(operator).startRound(34, SEED_CENTS, hre.ethers.ZeroHash);
      const seed = 78_125_000n * E18;
      const half = seed / 2n;

      // The batch must still pay the good recipient
      await expect(
        jackpot
          .connect(operator)
          .resolveRound(34, [winner.address, await rejector.getAddress()], [half, seed - half], 0n)
      ).to.not.be.reverted;

      expect(await token.balanceOf(winner.address)).to.equal(half);
      expect(await jackpot.claimable(await rejector.getAddress())).to.equal(seed - half);
      expect(await jackpot.totalClaimable()).to.equal(seed - half);
    });

    it("a deferred payout can be claimed once the block clears", async function () {
      const { jackpot, token, operator, winner, second } = await deploy();
      await token.setBlocked(second.address, true);

      await jackpot.connect(operator).startRound(34, SEED_CENTS, hre.ethers.ZeroHash);
      const seed = 78_125_000n * E18;
      await jackpot.connect(operator).resolveRound(34, [second.address], [seed], 0n);

      expect(await jackpot.claimable(second.address)).to.equal(seed);

      await token.setBlocked(second.address, false);
      await jackpot.connect(second).claim();

      expect(await token.balanceOf(second.address)).to.equal(seed);
      expect(await jackpot.claimable(second.address)).to.equal(0n);
      expect(await jackpot.totalClaimable()).to.equal(0n);
    });

    it("claimed balances are excluded from unallocated until claimed", async function () {
      const { jackpot, token, operator, second, tranche } = await deploy();
      await token.setBlocked(second.address, true);

      await jackpot.connect(operator).startRound(34, SEED_CENTS, hre.ethers.ZeroHash);
      const seed = 78_125_000n * E18;
      await jackpot.connect(operator).resolveRound(34, [second.address], [seed], 0n);

      // The deferred payout is still held here but is NOT sweepable
      expect(await jackpot.unallocated()).to.equal(tranche - seed);
    });
  });

  describe("access control", function () {
    it("only the operator or owner may start a round", async function () {
      const { jackpot, winner } = await deploy();
      await expect(
        jackpot.connect(winner).startRound(34, SEED_CENTS, hre.ethers.ZeroHash)
      ).to.be.revertedWithCustomError(jackpot, "NotOperator");
    });

    it("only the owner may sweep", async function () {
      const { jackpot, operator, treasury } = await deploy();
      await expect(jackpot.connect(operator).sweepUnallocated(treasury.address, 1n)).to.be.reverted;
    });

    it("pause stops new rounds but never blocks resolution or claims", async function () {
      const { jackpot, owner, operator, winner } = await deploy();
      await jackpot.connect(operator).startRound(34, SEED_CENTS, hre.ethers.ZeroHash);
      await jackpot.connect(owner).pause();

      await expect(
        jackpot.connect(operator).startRound(35, SEED_CENTS, hre.ethers.ZeroHash)
      ).to.be.reverted;

      // Escrowed funds must still be able to reach players
      const seed = 78_125_000n * E18;
      await expect(jackpot.connect(operator).resolveRound(34, [winner.address], [seed], 0n)).to.not
        .be.reverted;
    });
  });

  describe("ETH", function () {
    it("rejects ETH outright rather than trapping it", async function () {
      const { jackpot, owner } = await deploy();
      await expect(
        owner.sendTransaction({ to: await jackpot.getAddress(), value: 1n })
      ).to.be.reverted;
    });
  });
});
