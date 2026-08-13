import { expect } from "chai";
import hre from "hardhat";

/**
 * WordManagerV3 solvency tests.
 *
 * This contract has had no test coverage of any kind, while holding both
 * staked user deposits and the game's reward tranche in a single balance.
 * Until this change nothing separated them: distributeTop10Rewards,
 * distributeBonusReward and claimBonusWord transferred until the ERC20 itself
 * ran out, so game payouts were funded from staked principal and stakers only
 * discovered it when withdraw() reverted.
 *
 * The measured exposure that motivated this: ~218M free tokens against ~97.6M
 * of reward outflow per round — roughly two rounds before payouts start eating
 * deposits.
 */

const E18 = 10n ** 18n;
const THIRTY_DAYS = 30 * 24 * 60 * 60;

const ZERO_HASHES_10 = Array(10).fill(hre.ethers.ZeroHash) as string[];
const ZERO_HASHES_5 = Array(5).fill(hre.ethers.ZeroHash) as string[];

describe("WordManagerV3 — staker solvency", function () {
  async function deploy() {
    const [owner, operator, staker, player, second] = await hre.ethers.getSigners();

    const Token = await hre.ethers.getContractFactory("MockWordToken");
    const token = await Token.deploy();
    await token.waitForDeployment();

    const Manager = await hre.ethers.getContractFactory("WordManagerV3");
    const manager = await hre.upgrades.deployProxy(
      Manager,
      [await token.getAddress(), operator.address, THIRTY_DAYS],
      { initializer: "initialize", kind: "uups" }
    );
    await manager.waitForDeployment();

    return { owner, operator, staker, player, second, token, manager };
  }

  /** Stake `amount` from `staker`, so the contract holds principal it owes. */
  async function stake(ctx: any, amount: bigint) {
    await ctx.token.mint(ctx.staker.address, amount);
    await ctx.token.connect(ctx.staker).approve(await ctx.manager.getAddress(), amount);
    await ctx.manager.connect(ctx.staker).stake(amount);
  }

  /** Put `amount` of unencumbered game funds into the contract. */
  async function fundGames(ctx: any, amount: bigint) {
    await ctx.token.mint(await ctx.manager.getAddress(), amount);
  }

  describe("accounting", function () {
    it("reserves staked principal and excludes it from game funds", async function () {
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await fundGames(ctx, 40n * E18);

      expect(await ctx.manager.reservedForStakers()).to.equal(100n * E18);
      expect(await ctx.manager.availableForGames()).to.equal(40n * E18);
      expect(await ctx.manager.totalStaked()).to.equal(100n * E18);
    });

    it("reports zero available when only staked funds are present", async function () {
      const ctx = await deploy();
      await stake(ctx, 100n * E18);

      expect(await ctx.manager.availableForGames()).to.equal(0n);
    });

    it("does not underflow when the balance is below the reserve", async function () {
      // Reachable via the owner's emergencyWithdraw escape hatch, which is
      // deliberately not solvency-gated. availableForGames must saturate at
      // zero rather than revert, or every game call reverts opaquely.
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await ctx.manager.connect(ctx.owner).emergencyWithdraw(ctx.owner.address, 60n * E18);

      expect(await ctx.manager.availableForGames()).to.equal(0n);
    });

    it("also reserves rewards promised for the rest of the period", async function () {
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await fundGames(ctx, 300n * E18);

      await ctx.manager.connect(ctx.operator).notifyRewardAmount(300n * E18);

      // rewardRate is floored to whole wei per second, so the reserve is the
      // rate times the remaining seconds rather than exactly the notified sum.
      const rate: bigint = await ctx.manager.rewardRate();
      const reserved: bigint = await ctx.manager.reservedForStakers();

      expect(reserved).to.be.greaterThan(100n * E18);
      expect(reserved).to.equal(100n * E18 + rate * BigInt(THIRTY_DAYS));
      expect(await ctx.manager.availableForGames()).to.be.lessThan(E18);
    });
  });

  describe("distributeTop10Rewards", function () {
    it("pays out normally when game funds cover it", async function () {
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await fundGames(ctx, 50n * E18);

      await ctx.manager
        .connect(ctx.operator)
        .distributeTop10Rewards(1, [ctx.player.address, ctx.second.address], [30n * E18, 20n * E18]);

      expect(await ctx.token.balanceOf(ctx.player.address)).to.equal(30n * E18);
      expect(await ctx.token.balanceOf(ctx.second.address)).to.equal(20n * E18);
      expect(await ctx.manager.availableForGames()).to.equal(0n);
    });

    it("refuses a batch that would dip into staked principal", async function () {
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await fundGames(ctx, 50n * E18);

      await expect(
        ctx.manager
          .connect(ctx.operator)
          .distributeTop10Rewards(1, [ctx.player.address], [51n * E18])
      )
        .to.be.revertedWithCustomError(ctx.manager, "WouldTouchStakerFunds")
        .withArgs(51n * E18, 50n * E18);
    });

    it("checks the batch total, not each payment in isolation", async function () {
      // The regression this guards: with a per-transfer check, each payment
      // would be validated against a balance the previous transfer had already
      // reduced, and the batch would walk straight past the reserve. Here every
      // individual amount fits in the 50 available, but the sum does not.
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await fundGames(ctx, 50n * E18);

      await expect(
        ctx.manager
          .connect(ctx.operator)
          .distributeTop10Rewards(
            1,
            [ctx.player.address, ctx.second.address, ctx.owner.address],
            [40n * E18, 40n * E18, 40n * E18]
          )
      )
        .to.be.revertedWithCustomError(ctx.manager, "WouldTouchStakerFunds")
        .withArgs(120n * E18, 50n * E18);
    });

    it("leaves the staker able to withdraw in full after a refused batch", async function () {
      // The whole point: a reverted reward is re-runnable, an eaten deposit is
      // not. Before this guard the transfer would have succeeded and this
      // withdraw would revert.
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await fundGames(ctx, 50n * E18);

      await expect(
        ctx.manager.connect(ctx.operator).distributeTop10Rewards(1, [ctx.player.address], [90n * E18])
      ).to.be.revertedWithCustomError(ctx.manager, "WouldTouchStakerFunds");

      await ctx.manager.connect(ctx.staker).withdraw(100n * E18);
      expect(await ctx.token.balanceOf(ctx.staker.address)).to.equal(100n * E18);
    });

    it("still rejects mismatched array lengths", async function () {
      const ctx = await deploy();
      await fundGames(ctx, 50n * E18);

      await expect(
        ctx.manager.connect(ctx.operator).distributeTop10Rewards(1, [ctx.player.address], [])
      ).to.be.revertedWith("Length mismatch");
    });

    it("is operator-only", async function () {
      const ctx = await deploy();
      await fundGames(ctx, 50n * E18);

      await expect(
        ctx.manager.connect(ctx.player).distributeTop10Rewards(1, [ctx.player.address], [E18])
      ).to.be.revertedWithCustomError(ctx.manager, "NotOperator");
    });
  });

  describe("distributeBonusReward", function () {
    it("pays out within game funds", async function () {
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await fundGames(ctx, 10n * E18);

      await ctx.manager.connect(ctx.operator).distributeBonusReward(ctx.player.address, 10n * E18);
      expect(await ctx.token.balanceOf(ctx.player.address)).to.equal(10n * E18);
    });

    it("refuses to spend staked principal", async function () {
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await fundGames(ctx, 10n * E18);

      await expect(
        ctx.manager.connect(ctx.operator).distributeBonusReward(ctx.player.address, 11n * E18)
      )
        .to.be.revertedWithCustomError(ctx.manager, "WouldTouchStakerFunds")
        .withArgs(11n * E18, 10n * E18);
    });
  });

  describe("claimBonusWord", function () {
    async function committed(ctx: any) {
      const word = "HELLO";
      const salt = hre.ethers.id("salt");
      const hash = hre.ethers.solidityPackedKeccak256(["string", "bytes32"], [word, salt]);
      const bonusHashes = [...ZERO_HASHES_10];
      bonusHashes[0] = hash;
      await ctx.manager
        .connect(ctx.operator)
        .commitRound(1, hre.ethers.ZeroHash, bonusHashes, ZERO_HASHES_5);
      return { word, salt };
    }

    it("pays a valid claim within game funds", async function () {
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await fundGames(ctx, 10n * E18);
      const { word, salt } = await committed(ctx);

      await ctx.manager
        .connect(ctx.operator)
        .claimBonusReward(1, 0, word, salt, ctx.player.address, 5n * E18);

      expect(await ctx.token.balanceOf(ctx.player.address)).to.equal(5n * E18);
    });

    it("refuses a claim that would dip into staked principal", async function () {
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await fundGames(ctx, 10n * E18);
      const { word, salt } = await committed(ctx);

      await expect(
        ctx.manager
          .connect(ctx.operator)
          .claimBonusReward(1, 0, word, salt, ctx.player.address, 11n * E18)
      ).to.be.revertedWithCustomError(ctx.manager, "WouldTouchStakerFunds");
    });

    it("does not consume the claim slot when it reverts for insolvency", async function () {
      // The modifier runs before the body, so bonusWordClaimed is never set on
      // a rejected claim. If it were, topping the contract up afterwards would
      // not help — the reward would be permanently unclaimable.
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await fundGames(ctx, 10n * E18);
      const { word, salt } = await committed(ctx);

      await expect(
        ctx.manager
          .connect(ctx.operator)
          .claimBonusReward(1, 0, word, salt, ctx.player.address, 50n * E18)
      ).to.be.revertedWithCustomError(ctx.manager, "WouldTouchStakerFunds");

      await fundGames(ctx, 100n * E18);
      await ctx.manager
        .connect(ctx.operator)
        .claimBonusReward(1, 0, word, salt, ctx.player.address, 50n * E18);

      expect(await ctx.token.balanceOf(ctx.player.address)).to.equal(50n * E18);
    });
  });

  describe("staking is unaffected", function () {
    it("lets a staker withdraw principal even with zero game funds", async function () {
      // The guard must never apply to staker-facing paths — they are the
      // claimants it exists to protect.
      const ctx = await deploy();
      await stake(ctx, 100n * E18);

      await ctx.manager.connect(ctx.staker).withdraw(100n * E18);
      expect(await ctx.token.balanceOf(ctx.staker.address)).to.equal(100n * E18);
    });

    it("lets a staker exit while game funds are exhausted", async function () {
      const ctx = await deploy();
      await stake(ctx, 100n * E18);
      await fundGames(ctx, 20n * E18);
      await ctx.manager
        .connect(ctx.operator)
        .distributeTop10Rewards(1, [ctx.player.address], [20n * E18]);

      expect(await ctx.manager.availableForGames()).to.equal(0n);
      await ctx.manager.connect(ctx.staker).exit();
      expect(await ctx.token.balanceOf(ctx.staker.address)).to.equal(100n * E18);
    });
  });
});
