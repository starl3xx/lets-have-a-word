import { describe, it, expect, afterEach } from 'vitest';
import { ethers } from 'ethers';
import {
  planCheckpointReconcile,
  type LocalCheckpoint,
  type OnchainCheckpoint,
} from './guess-log';
import { checkpointIdFromReceipt } from './guess-log-contract';

/**
 * The repair for the checkpoint table drift seen in rounds 34 to 37. Each lost
 * one row because the poster read `checkpointCount` again after `tx.wait()`
 * and got the count from before its own post.
 */

const ROOT_A = '0x' + 'aa'.repeat(32);
const ROOT_B = '0x' + 'bb'.repeat(32);
const ROOT_C = '0x' + 'cc'.repeat(32);

function onchain(checkpointId: number, fromIndex: number, toIndex: number, root: string): OnchainCheckpoint {
  return { checkpointId, fromIndex, toIndex, root, postedAt: 1_760_000_000 + checkpointId };
}

function local(id: number, checkpointId: number, fromIndex: number, toIndex: number, root: string): LocalCheckpoint {
  return { id, checkpointId, fromIndex, toIndex, root };
}

describe('planCheckpointReconcile', () => {
  it('finds the one root that landed without a row (the round 36 shape)', () => {
    const plan = planCheckpointReconcile(
      [onchain(0, 1, 5, ROOT_A), onchain(1, 6, 11, ROOT_B), onchain(2, 12, 22, ROOT_C)],
      [local(10, 0, 1, 5, ROOT_A), local(11, 1, 6, 11, ROOT_B)]
    );
    expect(plan).toEqual({ ok: true, missing: [onchain(2, 12, 22, ROOT_C)], renumber: [] });
  });

  it('renumbers a first checkpoint stored as -1, and adds the lost one (the round 37 shape)', () => {
    const plan = planCheckpointReconcile(
      [onchain(0, 1, 2, ROOT_A), onchain(1, 3, 3, ROOT_B), onchain(2, 4, 4, ROOT_C)],
      [local(20, -1, 1, 2, ROOT_A), local(21, 1, 3, 3, ROOT_B)]
    );
    expect(plan).toEqual({
      ok: true,
      missing: [onchain(2, 4, 4, ROOT_C)],
      renumber: [{ id: 20, from: -1, to: 0 }],
    });
  });

  it('compares roots without regard to hex case', () => {
    const plan = planCheckpointReconcile(
      [onchain(0, 1, 2, ROOT_A)],
      [local(1, 0, 1, 2, ROOT_A.toUpperCase().replace('0X', '0x'))]
    );
    expect(plan).toEqual({ ok: true, missing: [], renumber: [] });
  });

  it('refuses a local row the contract has no checkpoint for', () => {
    const plan = planCheckpointReconcile([onchain(0, 1, 2, ROOT_A)], [local(1, 0, 1, 3, ROOT_A)]);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/no checkpoint for/);
  });

  it('refuses when a local root differs from the onchain root for the same range', () => {
    const plan = planCheckpointReconcile([onchain(0, 1, 2, ROOT_A)], [local(1, 0, 1, 2, ROOT_B)]);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/contract holds/);
  });

  it('refuses two local rows for one range', () => {
    const plan = planCheckpointReconcile(
      [onchain(0, 1, 2, ROOT_A)],
      [local(1, 0, 1, 2, ROOT_A), local(2, 5, 1, 2, ROOT_A)]
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/Two local rows/);
  });
});

describe('checkpointIdFromReceipt', () => {
  const ADDRESS = '0x' + '12'.repeat(20);
  const previous = process.env.GUESS_LOG_ADDRESS;

  afterEach(() => {
    if (previous === undefined) delete process.env.GUESS_LOG_ADDRESS;
    else process.env.GUESS_LOG_ADDRESS = previous;
  });

  /**
   * Built from the Solidity signature by hand, not from the module's ABI, so a
   * typo in the ABI string fails here instead of matching itself.
   */
  function rootPostedLog(address: string, roundId: number, checkpointId: number) {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    return {
      address,
      topics: [
        ethers.id('RootPosted(uint256,uint256,uint64,uint64,bytes32)'),
        ethers.zeroPadValue(ethers.toBeHex(roundId), 32),
        ethers.zeroPadValue(ethers.toBeHex(checkpointId), 32),
      ],
      data: coder.encode(['uint64', 'uint64', 'bytes32'], [3, 3, ROOT_A]),
    };
  }

  it('reads the id the contract emitted', () => {
    process.env.GUESS_LOG_ADDRESS = ADDRESS;
    const receipt = { logs: [rootPostedLog(ADDRESS, 37, 2)] } as unknown as ethers.TransactionReceipt;
    expect(checkpointIdFromReceipt(receipt, 37)).toBe(2);
  });

  it('ignores the same event from another address, and another round', () => {
    process.env.GUESS_LOG_ADDRESS = ADDRESS;
    const receipt = {
      logs: [rootPostedLog('0x' + '34'.repeat(20), 37, 9), rootPostedLog(ADDRESS, 36, 5)],
    } as unknown as ethers.TransactionReceipt;
    expect(checkpointIdFromReceipt(receipt, 37)).toBeNull();
  });

  it('returns null for a missing receipt', () => {
    process.env.GUESS_LOG_ADDRESS = ADDRESS;
    expect(checkpointIdFromReceipt(null, 37)).toBeNull();
  });
});
