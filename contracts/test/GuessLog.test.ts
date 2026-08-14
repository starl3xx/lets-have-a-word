import { expect } from "chai";
import hre from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

describe("GuessLog", function () {
  async function deploy() {
    const [owner, operator, other] = await hre.ethers.getSigners();
    const Log = await hre.ethers.getContractFactory("GuessLog");
    const log = await Log.deploy(operator.address);
    await log.waitForDeployment();
    return { log, owner, operator, other };
  }

  /**
   * Builds the same tree the backend builds. Leaf encoding must match
   * GuessLog.hashLeaf exactly — StandardMerkleTree double-hashes leaves, which
   * is why hashLeaf does too.
   */
  type Guess = [bigint, bigint, bigint, string, bigint];
  const LEAF_TYPES = ["uint256", "uint64", "uint256", "string", "uint64"];

  function buildTree(guesses: Guess[]) {
    return StandardMerkleTree.of(
      guesses.map((g) => g.map(String)),
      LEAF_TYPES
    );
  }

  function sampleGuesses(roundId: bigint, from: number, count: number): Guess[] {
    return Array.from({ length: count }, (_, i) => [
      roundId,
      BigInt(from + i),
      BigInt(1000 + i),
      ["HOUSE", "CRANE", "SLATE", "BRAIN", "AUDIO"][i % 5],
      BigInt(1_700_000_000 + i),
    ]);
  }

  describe("posting roots", function () {
    it("records a checkpoint and advances the expected index", async function () {
      const { log, operator } = await deploy();
      const tree = buildTree(sampleGuesses(34n, 0, 5));

      await expect(log.connect(operator).postRoot(34, 0, 4, tree.root))
        .to.emit(log, "RootPosted")
        .withArgs(34, 0, 0, 4, tree.root);

      expect(await log.checkpointCount(34)).to.equal(1);
      expect(await log.nextIndex(34)).to.equal(5);
    });

    it("keeps rounds independent", async function () {
      const { log, operator } = await deploy();
      const a = buildTree(sampleGuesses(34n, 0, 3));
      const b = buildTree(sampleGuesses(35n, 0, 3));

      await log.connect(operator).postRoot(34, 0, 2, a.root);
      await log.connect(operator).postRoot(35, 0, 2, b.root);

      expect(await log.nextIndex(34)).to.equal(3);
      expect(await log.nextIndex(35)).to.equal(3);
    });

    it("rejects a gap in the log", async function () {
      // The whole point of the contiguity rule: an operator must not be able
      // to skip a range of guesses it would rather not commit to.
      const { log, operator } = await deploy();
      const tree = buildTree(sampleGuesses(34n, 0, 5));
      await log.connect(operator).postRoot(34, 0, 4, tree.root);

      await expect(log.connect(operator).postRoot(34, 6, 9, tree.root))
        .to.be.revertedWithCustomError(log, "NonContiguous")
        .withArgs(5, 6);
    });

    it("rejects re-posting over a range already committed", async function () {
      // No amendments. A root that has been posted is part of the record even
      // if it was wrong.
      const { log, operator } = await deploy();
      const tree = buildTree(sampleGuesses(34n, 0, 5));
      await log.connect(operator).postRoot(34, 0, 4, tree.root);

      await expect(log.connect(operator).postRoot(34, 0, 4, tree.root))
        .to.be.revertedWithCustomError(log, "NonContiguous")
        .withArgs(5, 0);
    });

    it("rejects an empty range and a zero root", async function () {
      const { log, operator } = await deploy();
      await expect(log.connect(operator).postRoot(34, 5, 4, hre.ethers.id("x")))
        .to.be.revertedWithCustomError(log, "EmptyRange");
      await expect(log.connect(operator).postRoot(34, 0, 4, hre.ethers.ZeroHash))
        .to.be.revertedWithCustomError(log, "ZeroRoot");
    });

    it("allows a single-guess checkpoint", async function () {
      const { log, operator } = await deploy();
      const tree = buildTree(sampleGuesses(34n, 0, 1));
      await log.connect(operator).postRoot(34, 0, 0, tree.root);
      expect(await log.nextIndex(34)).to.equal(1);
    });
  });

  describe("leaf encoding", function () {
    it("Solidity hashLeaf matches what the backend's tree hashes", async function () {
      // The one assertion that spans the language boundary. The backend builds
      // trees with StandardMerkleTree in TypeScript and the contract verifies
      // against them in Solidity; if those two encodings ever drift, nothing
      // throws — the roots simply stop verifying, which is the worst failure
      // available to a log whose only job is to be checkable.
      const guesses = sampleGuesses(34n, 0, 4);
      const tree = buildTree(guesses);

      for (const g of guesses) {
        const fromSolidity = await (await deploy()).log.hashLeaf(g[0], g[1], g[2], g[3], g[4]);
        const fromTypeScript = tree.leafHash(g.map(String));
        expect(fromSolidity).to.equal(fromTypeScript);
      }
    });
  });

  describe("inclusion proofs", function () {
    it("verifies a guess that is in the committed block", async function () {
      const { log, operator } = await deploy();
      const guesses = sampleGuesses(34n, 0, 8);
      const tree = buildTree(guesses);
      await log.connect(operator).postRoot(34, 0, 7, tree.root);

      const target = guesses[3];
      const proof = tree.getProof(3);
      const leaf = await log.hashLeaf(target[0], target[1], target[2], target[3], target[4]);

      expect(await log.verifyInclusion(34, 0, leaf, proof)).to.equal(true);
    });

    it("rejects a guess whose word has been altered", async function () {
      // The point of the whole exercise: you cannot retell what was guessed.
      const { log, operator } = await deploy();
      const guesses = sampleGuesses(34n, 0, 8);
      const tree = buildTree(guesses);
      await log.connect(operator).postRoot(34, 0, 7, tree.root);

      const target = guesses[3];
      const proof = tree.getProof(3);
      const tampered = await log.hashLeaf(target[0], target[1], target[2], "OTHER", target[4]);

      expect(await log.verifyInclusion(34, 0, tampered, proof)).to.equal(false);
    });

    it("rejects a guess moved to a different position", async function () {
      // Ordering decides both the winner and the top-10, so reordering has to
      // break the proof just as surely as rewriting does.
      const { log, operator } = await deploy();
      const guesses = sampleGuesses(34n, 0, 8);
      const tree = buildTree(guesses);
      await log.connect(operator).postRoot(34, 0, 7, tree.root);

      const target = guesses[3];
      const proof = tree.getProof(3);
      const renumbered = await log.hashLeaf(target[0], 6, target[2], target[3], target[4]);

      expect(await log.verifyInclusion(34, 0, renumbered, proof)).to.equal(false);
    });

    it("rejects a valid leaf checked against the wrong checkpoint", async function () {
      const { log, operator } = await deploy();
      const first = sampleGuesses(34n, 0, 4);
      const second = sampleGuesses(34n, 4, 4);
      const t1 = buildTree(first);
      const t2 = buildTree(second);
      await log.connect(operator).postRoot(34, 0, 3, t1.root);
      await log.connect(operator).postRoot(34, 4, 7, t2.root);

      const target = first[1];
      const proof = t1.getProof(1);
      const leaf = await log.hashLeaf(target[0], target[1], target[2], target[3], target[4]);

      expect(await log.verifyInclusion(34, 0, leaf, proof)).to.equal(true);
      expect(await log.verifyInclusion(34, 1, leaf, proof)).to.equal(false);
    });

    it("reverts rather than silently failing for a checkpoint that does not exist", async function () {
      const { log } = await deploy();
      await expect(log.verifyInclusion(34, 0, hre.ethers.id("leaf"), []))
        .to.be.revertedWithCustomError(log, "NoSuchCheckpoint");
    });

    it("resists passing an internal node off as a leaf", async function () {
      // Second-preimage attack. Leaves are double-hashed precisely so that a
      // 64-byte internal node cannot be presented as a leaf and "proved" to be
      // in the tree.
      const { log, operator } = await deploy();
      const guesses = sampleGuesses(34n, 0, 4);
      const tree = buildTree(guesses);
      await log.connect(operator).postRoot(34, 0, 3, tree.root);

      // Reconstruct an internal node from two sibling leaves.
      const leafA = tree.leafHash(guesses[0].map(String));
      const leafB = tree.leafHash(guesses[1].map(String));
      const [lo, hi] = leafA < leafB ? [leafA, leafB] : [leafB, leafA];
      const internal = hre.ethers.keccak256(hre.ethers.concat([lo, hi]));

      // Claiming that internal node is itself a leaf must not verify.
      const siblingProof = tree.getProof(0).slice(1);
      expect(await log.verifyInclusion(34, 0, internal, siblingProof)).to.equal(false);
    });
  });

  describe("access control", function () {
    it("only the operator or owner may post", async function () {
      const { log, owner, operator, other } = await deploy();
      const tree = buildTree(sampleGuesses(34n, 0, 2));

      await expect(log.connect(other).postRoot(34, 0, 1, tree.root))
        .to.be.revertedWithCustomError(log, "NotOperator");

      await log.connect(owner).postRoot(34, 0, 1, tree.root);
      expect(await log.nextIndex(34)).to.equal(2);
    });

    it("the operator can be rotated without redeploying the log", async function () {
      const { log, owner, operator, other } = await deploy();
      const tree = buildTree(sampleGuesses(34n, 0, 2));

      await expect(log.connect(owner).setOperator(other.address))
        .to.emit(log, "OperatorChanged")
        .withArgs(operator.address, other.address);

      await log.connect(other).postRoot(34, 0, 1, tree.root);
      await expect(log.connect(operator).postRoot(34, 2, 3, tree.root))
        .to.be.revertedWithCustomError(log, "NotOperator");
    });

    it("only the owner may rotate the operator or transfer ownership", async function () {
      const { log, other } = await deploy();
      await expect(log.connect(other).setOperator(other.address))
        .to.be.revertedWithCustomError(log, "NotOwner");
      await expect(log.connect(other).transferOwnership(other.address))
        .to.be.revertedWithCustomError(log, "NotOwner");
    });

    it("refuses a zero address anywhere it would brick the log", async function () {
      const { log, owner } = await deploy();
      await expect(log.connect(owner).setOperator(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(log, "ZeroAddress");
      await expect(log.connect(owner).transferOwnership(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(log, "ZeroAddress");

      const Log = await hre.ethers.getContractFactory("GuessLog");
      await expect(Log.deploy(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(Log, "ZeroAddress");
    });
  });
});
