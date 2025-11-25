/**
 * JackpotManager Test Suite
 * Milestone 6.1 - Smart Contract Specification
 */

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("JackpotManager", function () {
  const MINIMUM_SEED = hre.ethers.parseEther("0.03");
  const GUESS_PRICE = hre.ethers.parseEther("0.0003"); // 3 guesses at 0.0001 ETH each

  async function deployJackpotManagerFixture() {
    const [owner, operator, creatorProfit, prizePool, player1, player2, winner] =
      await hre.ethers.getSigners();

    const JackpotManager = await hre.ethers.getContractFactory("JackpotManager");

    const jackpotManager = await hre.upgrades.deployProxy(
      JackpotManager,
      [operator.address, creatorProfit.address, prizePool.address],
      { initializer: "initialize", kind: "uups" }
    );

    await jackpotManager.waitForDeployment();

    return { jackpotManager, owner, operator, creatorProfit, prizePool, player1, player2, winner };
  }

  describe("Initialization", function () {
    it("should set correct initial values", async function () {
      const { jackpotManager, operator, creatorProfit, prizePool } = await loadFixture(deployJackpotManagerFixture);

      expect(await jackpotManager.operatorWallet()).to.equal(operator.address);
      expect(await jackpotManager.creatorProfitWallet()).to.equal(creatorProfit.address);
      expect(await jackpotManager.prizePoolWallet()).to.equal(prizePool.address);
      expect(await jackpotManager.currentRound()).to.equal(0);
      expect(await jackpotManager.currentJackpot()).to.equal(0);
    });

    it("should have correct constants", async function () {
      const { jackpotManager } = await loadFixture(deployJackpotManagerFixture);

      expect(await jackpotManager.MINIMUM_SEED()).to.equal(MINIMUM_SEED);
      expect(await jackpotManager.JACKPOT_SHARE_BPS()).to.equal(8000);
      expect(await jackpotManager.CREATOR_SHARE_BPS()).to.equal(2000);
    });
  });

  describe("Jackpot Seeding", function () {
    it("should allow operator to seed jackpot", async function () {
      const { jackpotManager, operator } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });

      expect(await jackpotManager.currentJackpot()).to.equal(MINIMUM_SEED);
      expect(await jackpotManager.currentRound()).to.equal(1);
    });

    it("should not start round if seed below minimum", async function () {
      const { jackpotManager, operator } = await loadFixture(deployJackpotManagerFixture);

      const smallSeed = hre.ethers.parseEther("0.01");
      await jackpotManager.connect(operator).seedJackpot({ value: smallSeed });

      expect(await jackpotManager.currentJackpot()).to.equal(smallSeed);
      expect(await jackpotManager.currentRound()).to.equal(0);
    });

    it("should emit JackpotSeeded event", async function () {
      const { jackpotManager, operator } = await loadFixture(deployJackpotManagerFixture);

      await expect(jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED }))
        .to.emit(jackpotManager, "JackpotSeeded")
        .withArgs(1, operator.address, MINIMUM_SEED, MINIMUM_SEED);
    });

    it("should revert if non-operator tries to seed", async function () {
      const { jackpotManager, player1 } = await loadFixture(deployJackpotManagerFixture);

      await expect(
        jackpotManager.connect(player1).seedJackpot({ value: MINIMUM_SEED })
      ).to.be.revertedWithCustomError(jackpotManager, "OnlyOperator");
    });
  });

  describe("Starting Rounds", function () {
    it("should start round automatically when minimum seed is met", async function () {
      const { jackpotManager, operator } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });

      const round = await jackpotManager.getRound(1);
      expect(round.isActive).to.be.true;
      expect(round.startingJackpot).to.equal(MINIMUM_SEED);
    });

    it("should emit RoundStarted event", async function () {
      const { jackpotManager, operator } = await loadFixture(deployJackpotManagerFixture);

      await expect(jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED }))
        .to.emit(jackpotManager, "RoundStarted");
    });
  });

  describe("Purchasing Guesses", function () {
    it("should allow guess purchases during active round", async function () {
      const { jackpotManager, operator, player1 } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });
      await jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
        value: GUESS_PRICE,
      });

      expect(await jackpotManager.getPlayerGuessCount(player1.address)).to.equal(3);
    });

    it("should split payment 80/20 between jackpot and creator", async function () {
      const { jackpotManager, operator, player1 } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });

      const initialJackpot = await jackpotManager.currentJackpot();
      const initialCreatorProfit = await jackpotManager.creatorProfitAccumulated();

      await jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
        value: GUESS_PRICE,
      });

      const expectedToJackpot = (GUESS_PRICE * 8000n) / 10000n;
      const expectedToCreator = GUESS_PRICE - expectedToJackpot;

      expect(await jackpotManager.currentJackpot()).to.equal(initialJackpot + expectedToJackpot);
      expect(await jackpotManager.creatorProfitAccumulated()).to.equal(
        initialCreatorProfit + expectedToCreator
      );
    });

    it("should emit GuessesPurchased event", async function () {
      const { jackpotManager, operator, player1 } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });

      const expectedToJackpot = (GUESS_PRICE * 8000n) / 10000n;
      const expectedToCreator = GUESS_PRICE - expectedToJackpot;

      await expect(
        jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
          value: GUESS_PRICE,
        })
      )
        .to.emit(jackpotManager, "GuessesPurchased")
        .withArgs(1, player1.address, 3, GUESS_PRICE, expectedToJackpot, expectedToCreator);
    });

    it("should revert if round not active", async function () {
      const { jackpotManager, player1 } = await loadFixture(deployJackpotManagerFixture);

      await expect(
        jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
          value: GUESS_PRICE,
        })
      ).to.be.revertedWithCustomError(jackpotManager, "RoundNotActive");
    });
  });

  describe("Round Resolution", function () {
    it("should pay winner and end round", async function () {
      const { jackpotManager, operator, player1, winner } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });
      await jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
        value: hre.ethers.parseEther("0.01"),
      });

      const jackpotBefore = await jackpotManager.currentJackpot();
      const winnerBalanceBefore = await hre.ethers.provider.getBalance(winner.address);

      await jackpotManager.connect(operator).resolveRound(winner.address);

      const winnerBalanceAfter = await hre.ethers.provider.getBalance(winner.address);
      expect(winnerBalanceAfter - winnerBalanceBefore).to.equal(jackpotBefore);

      const round = await jackpotManager.getRound(1);
      expect(round.isActive).to.be.false;
      expect(round.winner).to.equal(winner.address);
      expect(round.winnerPayout).to.equal(jackpotBefore);
    });

    it("should reset jackpot to zero after resolution", async function () {
      const { jackpotManager, operator, player1, winner } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });
      await jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
        value: hre.ethers.parseEther("0.01"),
      });

      await jackpotManager.connect(operator).resolveRound(winner.address);
      expect(await jackpotManager.currentJackpot()).to.equal(0);
    });

    it("should emit RoundResolved event", async function () {
      const { jackpotManager, operator, player1, winner } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });
      await jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
        value: hre.ethers.parseEther("0.01"),
      });

      const jackpotBefore = await jackpotManager.currentJackpot();

      await expect(jackpotManager.connect(operator).resolveRound(winner.address))
        .to.emit(jackpotManager, "RoundResolved");
    });

    it("should revert if non-operator tries to resolve", async function () {
      const { jackpotManager, operator, player1, winner } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });

      await expect(
        jackpotManager.connect(player1).resolveRound(winner.address)
      ).to.be.revertedWithCustomError(jackpotManager, "OnlyOperator");
    });

    it("should revert if winner address is zero", async function () {
      const { jackpotManager, operator } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });

      await expect(
        jackpotManager.connect(operator).resolveRound(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(jackpotManager, "InvalidWinnerAddress");
    });
  });

  describe("Creator Profit Withdrawal", function () {
    it("should allow withdrawal of accumulated creator profit", async function () {
      const { jackpotManager, operator, creatorProfit, player1 } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });
      await jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
        value: hre.ethers.parseEther("0.01"),
      });

      const profitBefore = await jackpotManager.creatorProfitAccumulated();
      const creatorBalanceBefore = await hre.ethers.provider.getBalance(creatorProfit.address);

      await jackpotManager.withdrawCreatorProfit();

      const creatorBalanceAfter = await hre.ethers.provider.getBalance(creatorProfit.address);
      expect(creatorBalanceAfter - creatorBalanceBefore).to.equal(profitBefore);
      expect(await jackpotManager.creatorProfitAccumulated()).to.equal(0);
    });

    it("should emit CreatorProfitPaid event", async function () {
      const { jackpotManager, operator, creatorProfit, player1 } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });
      await jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
        value: hre.ethers.parseEther("0.01"),
      });

      const profitBefore = await jackpotManager.creatorProfitAccumulated();

      await expect(jackpotManager.withdrawCreatorProfit())
        .to.emit(jackpotManager, "CreatorProfitPaid")
        .withArgs(creatorProfit.address, profitBefore);
    });

    it("should revert if no profit to withdraw", async function () {
      const { jackpotManager, operator, player1 } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });
      await jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
        value: hre.ethers.parseEther("0.01"),
      });

      await jackpotManager.withdrawCreatorProfit(); // First withdrawal

      await expect(jackpotManager.withdrawCreatorProfit()).to.be.revertedWithCustomError(
        jackpotManager,
        "NoProfitToWithdraw"
      );
    });
  });

  describe("Admin Functions", function () {
    it("should allow owner to update operator wallet", async function () {
      const { jackpotManager, owner, player1 } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(owner).setOperatorWallet(player1.address);
      expect(await jackpotManager.operatorWallet()).to.equal(player1.address);
    });

    it("should allow owner to update creator profit wallet", async function () {
      const { jackpotManager, owner, player1 } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(owner).setCreatorProfitWallet(player1.address);
      expect(await jackpotManager.creatorProfitWallet()).to.equal(player1.address);
    });

    it("should allow owner to update prize pool wallet", async function () {
      const { jackpotManager, owner, player1 } = await loadFixture(deployJackpotManagerFixture);

      await jackpotManager.connect(owner).setPrizePoolWallet(player1.address);
      expect(await jackpotManager.prizePoolWallet()).to.equal(player1.address);
    });

    it("should revert if non-owner tries to update wallets", async function () {
      const { jackpotManager, player1, player2 } = await loadFixture(deployJackpotManagerFixture);

      await expect(
        jackpotManager.connect(player1).setOperatorWallet(player2.address)
      ).to.be.revertedWithCustomError(jackpotManager, "OwnableUnauthorizedAccount");
    });
  });

  describe("Multiple Rounds", function () {
    it("should handle multiple rounds correctly", async function () {
      const { jackpotManager, operator, player1, winner } = await loadFixture(deployJackpotManagerFixture);

      // Round 1
      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });
      await jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
        value: GUESS_PRICE,
      });
      await jackpotManager.connect(operator).resolveRound(winner.address);

      expect(await jackpotManager.currentRound()).to.equal(1);

      // Round 2
      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });
      expect(await jackpotManager.currentRound()).to.equal(2);

      const round2 = await jackpotManager.getRound(2);
      expect(round2.isActive).to.be.true;
    });
  });

  describe("Receive ETH", function () {
    it("should accept ETH from prize pool wallet and add to jackpot", async function () {
      const { jackpotManager, prizePool } = await loadFixture(deployJackpotManagerFixture);

      await prizePool.sendTransaction({
        to: await jackpotManager.getAddress(),
        value: MINIMUM_SEED,
      });

      expect(await jackpotManager.currentJackpot()).to.equal(MINIMUM_SEED);
    });

    it("should accept ETH from operator wallet and add to jackpot", async function () {
      const { jackpotManager, operator } = await loadFixture(deployJackpotManagerFixture);

      await operator.sendTransaction({
        to: await jackpotManager.getAddress(),
        value: MINIMUM_SEED,
      });

      expect(await jackpotManager.currentJackpot()).to.equal(MINIMUM_SEED);
    });
  });
});
