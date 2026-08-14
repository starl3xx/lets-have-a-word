import { expect } from "chai";
import hre from "hardhat";

describe("WordPackSales", function () {
  async function deploy() {
    const [owner, player, other, treasury] = await hre.ethers.getSigners();
    const Sales = await hre.ethers.getContractFactory("WordPackSales");
    const sales = await Sales.deploy(treasury.address);
    await sales.waitForDeployment();
    return { sales, owner, player, other, treasury };
  }

  it("records the payer as msg.sender, not a caller-supplied argument", async function () {
    const { sales, player } = await deploy();
    const value = hre.ethers.parseEther("0.0004");

    // purchaseGuesses takes `player` as a parameter, so its event records
    // whatever the caller passes. Here the payer cannot be spoofed.
    await expect(sales.connect(player).buyPacks(1, 34, { value }))
      .to.emit(sales, "PacksPurchased")
      .withArgs(player.address, 34, 1, value);
  });

  it("holds ETH rather than forwarding, so a treasury problem cannot fail a purchase", async function () {
    const { sales, player } = await deploy();
    const value = hre.ethers.parseEther("0.0004");
    await sales.connect(player).buyPacks(3, 34, { value });
    expect(await hre.ethers.provider.getBalance(await sales.getAddress())).to.equal(value);
  });

  it("rejects a zero payment and a zero pack count", async function () {
    const { sales, player } = await deploy();
    await expect(
      sales.connect(player).buyPacks(1, 34, { value: 0 })
    ).to.be.revertedWithCustomError(sales, "ZeroPayment");
    await expect(
      sales.connect(player).buyPacks(0, 34, { value: hre.ethers.parseEther("0.0004") })
    ).to.be.revertedWithCustomError(sales, "ZeroPackCount");
  });

  it("withdraw is permissionless but can only pay the immutable treasury", async function () {
    const { sales, player, other, treasury } = await deploy();
    const value = hre.ethers.parseEther("0.01");
    await sales.connect(player).buyPacks(1, 34, { value });

    const before = await hre.ethers.provider.getBalance(treasury.address);
    // Called by an unrelated account — the destination is fixed at construction
    await expect(sales.connect(other).withdraw())
      .to.emit(sales, "Withdrawn")
      .withArgs(treasury.address, value);

    expect(await hre.ethers.provider.getBalance(treasury.address)).to.equal(before + value);
    expect(await hre.ethers.provider.getBalance(await sales.getAddress())).to.equal(0n);
  });

  it("reverts withdraw when there is nothing to send", async function () {
    const { sales } = await deploy();
    await expect(sales.withdraw()).to.be.revertedWithCustomError(sales, "NothingToWithdraw");
  });

  it("rejects bare ETH so nothing arrives unattributed", async function () {
    const { sales, player } = await deploy();
    // An unattributed payment is one the backend could never credit to anyone
    await expect(
      player.sendTransaction({ to: await sales.getAddress(), value: 1n })
    ).to.be.reverted;
  });

  it("rejects a zero treasury at construction", async function () {
    const Sales = await hre.ethers.getContractFactory("WordPackSales");
    await expect(Sales.deploy(hre.ethers.ZeroAddress)).to.be.revertedWithCustomError(
      Sales,
      "ZeroTreasury"
    );
  });

  describe("buySuperguess", function () {
    it("records the payer as msg.sender", async function () {
      const { sales, player } = await deploy();
      const value = hre.ethers.parseEther("0.005");

      await expect(sales.connect(player).buySuperguess(34, { value }))
        .to.emit(sales, "SuperguessPurchased")
        .withArgs(player.address, 34, value);
    });

    it("rejects a zero payment", async function () {
      const { sales, player } = await deploy();
      await expect(sales.connect(player).buySuperguess(34, { value: 0 }))
        .to.be.revertedWithCustomError(sales, "ZeroPayment");
    });

    it("emits a DIFFERENT event from buyPacks", async function () {
      // The two products grant different things — guess credits versus a
      // timed 25-guess session, one per round. If they shared an event, a
      // pack receipt could be presented to claim a Superguess.
      const { sales, player } = await deploy();
      const value = hre.ethers.parseEther("0.005");

      await expect(sales.connect(player).buySuperguess(34, { value }))
        .to.not.emit(sales, "PacksPurchased");
      await expect(sales.connect(player).buyPacks(1, 34, { value }))
        .to.not.emit(sales, "SuperguessPurchased");
    });

    it("accumulates alongside pack revenue and withdraws together", async function () {
      const { sales, player, treasury } = await deploy();
      await sales.connect(player).buyPacks(1, 34, { value: hre.ethers.parseEther("0.0004") });
      await sales.connect(player).buySuperguess(34, { value: hre.ethers.parseEther("0.005") });

      const before = await hre.ethers.provider.getBalance(treasury.address);
      await sales.connect(player).withdraw();
      const after = await hre.ethers.provider.getBalance(treasury.address);

      expect(after - before).to.equal(hre.ethers.parseEther("0.0054"));
    });
  });
});