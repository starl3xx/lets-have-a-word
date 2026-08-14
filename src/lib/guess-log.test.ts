import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { buildGuessTree, GUESS_LEAF_TYPES, type GuessLeaf } from './guess-log';

/**
 * The leaf encoding here has to stay byte-identical to GuessLog.hashLeaf in
 * Solidity. Nothing enforces that across the language boundary, and a drift
 * would not throw — it would produce roots that verify against nothing, which
 * is the worst possible failure for a log whose only job is to be checkable.
 * So the encoding is reproduced independently below and compared.
 */

function leaf(overrides: Partial<GuessLeaf> = {}): GuessLeaf {
  return {
    guessId: 1,
    roundId: 34,
    index: 1,
    fid: 6500,
    word: 'HOUSE',
    guessedAt: 1_700_000_000,
    ...overrides,
  };
}

/** What GuessLog.hashLeaf computes, written out by hand. */
function solidityLeafHash(l: GuessLeaf): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    [...GUESS_LEAF_TYPES],
    [l.roundId, l.index, l.fid, l.word, l.guessedAt]
  );
  return ethers.keccak256(ethers.concat([ethers.keccak256(encoded)]));
}

describe('guess log Merkle tree', () => {
  it('produces leaf hashes matching the contract encoding', () => {
    const leaves = [leaf({ index: 1 }), leaf({ index: 2, word: 'CRANE' })];
    const tree = buildGuessTree(leaves);

    for (const l of leaves) {
      const fromTree = tree.leafHash([
        String(l.roundId),
        String(l.index),
        String(l.fid),
        l.word,
        String(l.guessedAt),
      ]);
      expect(fromTree).toBe(solidityLeafHash(l));
    }
  });

  it('double-hashes leaves, so an internal node is not a valid leaf', () => {
    // Second-preimage resistance. If leaves were hashed once, a 64-byte
    // internal node could be passed off as a leaf.
    const l = leaf();
    const singleHashed = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        [...GUESS_LEAF_TYPES],
        [l.roundId, l.index, l.fid, l.word, l.guessedAt]
      )
    );
    expect(solidityLeafHash(l)).not.toBe(singleHashed);
  });

  it('generates a proof that verifies against its own root', () => {
    const leaves = Array.from({ length: 9 }, (_, i) =>
      leaf({ guessId: i + 1, index: i + 1, fid: 1000 + i, word: ['HOUSE', 'CRANE', 'SLATE'][i % 3] })
    );
    const tree = buildGuessTree(leaves);

    leaves.forEach((l, i) => {
      const proof = tree.getProof(i);
      const value = [
        String(l.roundId),
        String(l.index),
        String(l.fid),
        l.word,
        String(l.guessedAt),
      ];
      expect(StandardMerkleTree.verify(tree.root, [...GUESS_LEAF_TYPES], value, proof)).toBe(true);
    });
  });

  it('changes the root when a word changes', () => {
    const before = buildGuessTree([leaf({ index: 1 }), leaf({ index: 2, word: 'CRANE' })]);
    const after = buildGuessTree([leaf({ index: 1 }), leaf({ index: 2, word: 'SLATE' })]);
    expect(after.root).not.toBe(before.root);
  });

  it('changes the root when two guesses swap position', () => {
    // Ordering decides the winner and the top-10, so reordering has to be as
    // detectable as rewriting.
    const a = leaf({ guessId: 1, index: 1, fid: 111, word: 'HOUSE' });
    const b = leaf({ guessId: 2, index: 2, fid: 222, word: 'CRANE' });

    const original = buildGuessTree([a, b]);
    const swapped = buildGuessTree([
      { ...a, index: 2 },
      { ...b, index: 1 },
    ]);

    expect(swapped.root).not.toBe(original.root);
  });

  it('changes the root when a guess is attributed to a different player', () => {
    const before = buildGuessTree([leaf({ fid: 111 })]);
    const after = buildGuessTree([leaf({ fid: 222 })]);
    expect(after.root).not.toBe(before.root);
  });

  it('refuses to build a tree over zero guesses', () => {
    // An empty tree has no meaningful root, and committing one would advance
    // the contract's index over a range containing nothing.
    expect(() => buildGuessTree([])).toThrow(/zero guesses/i);
  });

  it('is deterministic — the same guesses always give the same root', () => {
    const leaves = Array.from({ length: 5 }, (_, i) => leaf({ guessId: i + 1, index: i + 1 }));
    expect(buildGuessTree(leaves).root).toBe(buildGuessTree(leaves).root);
  });
});
