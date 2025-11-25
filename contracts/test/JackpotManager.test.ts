/**
 * JackpotManager Test Suite
 * Milestone 6.1 - Smart Contract Specification
 */

import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { JackpotManager } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("JackpotManager", function () {
  let jackpotManager: JackpotManager;
  let owner: SignerWithAddress;
  let operator: SignerWithAddress;
  let creatorProfit: SignerWithAddress;
  let prizePool: SignerWithAddress;
  let player1: SignerWithAddress;
  let player2: SignerWithAddress;
  let winner: SignerWithAddress;

  const MINIMUM_SEED = ethers.parseEther("0.03");
  const GUESS_PRICE = ethers.parseEther("0.0003"); // 3 guesses at 0.0001 ETH each

  beforeEach(async function () {
    [owner, operator, creatorProfit, prizePool, player1, player2, winner] =
      await ethers.getSigners();

    const JackpotManager = await ethers.getContractFactory("JackpotManager");

    jackpotManager = (await upgrades.deployProxy(
      JackpotManager,
      [operator.address, creatorProfit.address, prizePool.address],
      { initializer: "initialize", kind: "uups" }
    )) as unknown as JackpotManager;

    await jackpotManager.waitForDeployment();
  });

  describe("Initialization", function () {
    it("should set correct initial values", async function () {
      expect(await jackpotManager.operatorWallet()).to.equal(operator.address);
      expect(await jackpotManager.creatorProfitWallet()).to.equal(creatorProfit.address);
      expect(await jackpotManager.prizePoolWallet()).to.equal(prizePool.address);
      expect(await jackpotManager.currentRound()).to.equal(0);
      expect(await jackpotManager.currentJackpot()).to.equal(0);
    });

    it("should have correct constants", async function () {
      expect(await jackpotManager.MINIMUM_SEED()).to.equal(MINIMUM_SEED);
      expect(await jackpotManager.JACKPOT_SHARE_BPS()).to.equal(8000);
      expect(await jackpotManager.CREATOR_SHARE_BPS()).to.equal(2000);
    });
  });

  describe("Jackpot Seeding", function () {
    it("should allow operator to seed jackpot", async function () {
      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });

      expect(await jackpotManager.currentJackpot()).to.equal(MINIMUM_SEED);
      expect(await jackpotManager.currentRound()).to.equal(1);
    });

    it("should not start round if seed below minimum", async function () {
      const smallSeed = ethers.parseEther("0.01");
      await jackpotManager.connect(operator).seedJackpot({ value: smallSeed });

      expect(await jackpotManager.currentJackpot()).to.equal(smallSeed);
      expect(await jackpotManager.currentRound()).to.equal(0);
    });

    it("should emit JackpotSeeded event", async function () {
      await expect(jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED }))
        .to.emit(jackpotManager, "JackpotSeeded")
        .withArgs(1, operator.address, MINIMUM_SEED, MINIMUM_SEED);
    });

    it("should revert if non-operator tries to seed", async function () {
      await expect(
        jackpotManager.connect(player1).seedJackpot({ value: MINIMUM_SEED })
      ).to.be.revertedWithCustomError(jackpotManager, "OnlyOperator");
    });
  });

  describe("Starting Rounds", function () {
    it("should start round automatically when minimum seed is met", async function () {
      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });

      const round = await jackpotManager.getRound(1);
      expect(round.isActive).to.be.true;
      expect(round.startingJackpot).to.equal(MINIMUM_SEED);
    });

    it("should emit RoundStarted event", async function () {
      await expect(jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED }))
        .to.emit(jackpotManager, "RoundStarted");
    });
  });

  describe("Purchasing Guesses", function () {
    beforeEach(async function () {
      // Seed jackpot to start round
      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });
    });

    it("should allow guess purchases during active round", async function () {
      await jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
        value: GUESS_PRICE,
      });

      expect(await jackpotManager.getPlayerGuessCount(player1.address)).to.equal(3);
    });

    it("should split payment 80/20 between jackpot and creator", async function () {
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
      // Create a new contract without seeding
      const JackpotManager = await ethers.getContractFactory("JackpotManager");
      const newManager = await upgrades.deployProxy(
        JackpotManager,
        [operator.address, creatorProfit.address, prizePool.address],
        { initializer: "initialize", kind: "uups" }
      );

      await expect(
        newManager.connect(player1).purchaseGuesses(player1.address, 3, {
          value: GUESS_PRICE,
        })
      ).to.be.revertedWithCustomError(newManager, "RoundNotActive");
    });
  });

  describe("Round Resolution", function () {
    beforeEach(async function () {
      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });

      // Add some paid guesses to increase jackpot
      await jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
        value: ethers.parseEther("0.01"),
      });
    });

    it("should pay winner and end round", async function () {
      const jackpotBefore = await jackpotManager.currentJackpot();
      const winnerBalanceBefore = await ethers.provider.getBalance(winner.address);

      await jackpotManager.connect(operator).resolveRound(winner.address);

      const winnerBalanceAfter = await ethers.provider.getBalance(winner.address);
      expect(winnerBalanceAfter - winnerBalanceBefore).to.equal(jackpotBefore);

      const round = await jackpotManager.getRound(1);
      expect(round.isActive).to.be.false;
      expect(round.winner).to.equal(winner.address);
      expect(round.winnerPayout).to.equal(jackpotBefore);
    });

    it("should reset jackpot to zero after resolution", async function () {
      await jackpotManager.connect(operator).resolveRound(winner.address);
      expect(await jackpotManager.currentJackpot()).to.equal(0);
    });

    it("should emit RoundResolved event", async function () {
      const jackpotBefore = await jackpotManager.currentJackpot();

      await expect(jackpotManager.connect(operator).resolveRound(winner.address))
        .to.emit(jackpotManager, "RoundResolved")
        .withArgs(1, winner.address, jackpotBefore, jackpotBefore, await getBlockTimestamp());
    });

    it("should revert if non-operator tries to resolve", async function () {
      await expect(
        jackpotManager.connect(player1).resolveRound(winner.address)
      ).to.be.revertedWithCustomError(jackpotManager, "OnlyOperator");
    });

    it("should revert if winner address is zero", async function () {
      await expect(
        jackpotManager.connect(operator).resolveRound(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(jackpotManager, "InvalidWinnerAddress");
    });
  });

  describe("Creator Profit Withdrawal", function () {
    beforeEach(async function () {
      await jackpotManager.connect(operator).seedJackpot({ value: MINIMUM_SEED });
      await jackpotManager.connect(player1).purchaseGuesses(player1.address, 3, {
        value: ethers.parseEther("0.01"),
      });
    });

    it("should allow withdrawal of accumulated creator profit", async function () {
      const profitBefore = await jackpotManager.creatorProfitAccumulated();
      const creatorBalanceBefore = await ethers.provider.getBalance(creatorProfit.address);

      await jackpotManager.withdrawCreatorProfit();

      const creatorBalanceAfter = await ethers.provider.getBalance(creatorProfit.address);
      expect(creatorBalanceAfter - creatorBalanceBefore).to.equal(profitBefore);
      expect(await jackpotManager.creatorProfitAccumulated()).to.equal(0);
    });

    it("should emit CreatorProfitPaid event", async function () {
      const profitBefore = await jackpotManager.creatorProfitAccumulated();

      await expect(jackpotManager.withdrawCreatorProfit())
        .to.emit(jackpotManager, "CreatorProfitPaid")
        .withArgs(creatorProfit.address, profitBefore);
    });

    it("should revert if no profit to withdraw", async function () {
      await jackpotManager.withdrawCreatorProfit(); // First withdrawal

      await expect(jackpotManager.withdrawCreatorProfit()).to.be.revertedWithCustomError(
        jackpotManager,
        "NoProfitToWithdraw"
      );
    });
  });

  describe("Admin Functions", function () {
    it("should allow owner to update operator wallet", async function () {
      await jackpotManager.connect(owner).setOperatorWallet(player1.address);
      expect(await jackpotManager.operatorWallet()).to.equal(player1.address);
    });

    it("should allow owner to update creator profit wallet", async function () {
      await jackpotManager.connect(owner).setCreatorProfitWallet(player1.address);
      expect(await jackpotManager.creatorProfitWallet()).to.equal(player1.address);
    });

    it("should allow owner to update prize pool wallet", async function () {
      await jackpotManager.connect(owner).setPrizePoolWallet(player1.address);
      expect(await jackpotManager.prizePoolWallet()).to.equal(player1.address);
    });

    it("should revert if non-owner tries to update wallets", async function () {
      await expect(
        jackpotManager.connect(player1).setOperatorWallet(player2.address)
      ).to.be.revertedWithCustomError(jackpotManager, "OwnableUnauthorizedAccount");
    });
  });

  describe("Multiple Rounds", function () {
    it("should handle multiple rounds correctly", async function () {
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
      await prizePool.sendTransaction({
        to: await jackpotManager.getAddress(),
        value: MINIMUM_SEED,
      });

      expect(await jackpotManager.currentJackpot()).to.equal(MINIMUM_SEED);
    });

    it("should accept ETH from operator wallet and add to jackpot", async function () {
      await operator.sendTransaction({
        to: await jackpotManager.getAddress(),
        value: MINIMUM_SEED,
      });

      expect(await jackpotManager.currentJackpot()).to.equal(MINIMUM_SEED);
    });
  });

  // Helper function
  async function getBlockTimestamp(): Promise<number> {
    const block = await ethers.provider.getBlock("latest");
    return block!.timestamp;
  }
});
