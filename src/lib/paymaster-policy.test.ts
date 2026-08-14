import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { willSponsor, BUY_PACKS_SELECTOR } from './paymaster-policy';

/**
 * This function is the spending authority for the paymaster endpoint. The URL
 * is public by necessity — the wallet fetches it directly — so anything that
 * gets past these checks is something the project pays gas for on behalf of a
 * stranger. Each test below is a way to ask it to pay for something else.
 */

const SALES = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

const coder = ethers.AbiCoder.defaultAbiCoder();

/** buyPacks(uint32 packCount, uint256 roundId) */
function buyPacksCall(packCount = 1, roundId = 34): string {
  return (
    BUY_PACKS_SELECTOR + coder.encode(['uint32', 'uint256'], [packCount, roundId]).slice(2)
  );
}

/** execute(address,uint256,bytes) — the common ERC-4337 account wrapper */
function execute(target: string, data: string, value = 0n): string {
  return (
    '0xb61d27f6' + coder.encode(['address', 'uint256', 'bytes'], [target, value, data]).slice(2)
  );
}

/** executeBatch((address,uint256,bytes)[]) — Coinbase Smart Wallet */
function executeBatch(calls: Array<{ target: string; data: string; value?: bigint }>): string {
  return (
    '0x34fcd5be' +
    coder
      .encode(
        ['tuple(address,uint256,bytes)[]'],
        [calls.map((c) => [c.target, c.value ?? 0n, c.data])]
      )
      .slice(2)
  );
}

describe('willSponsor', () => {
  it('sponsors a pack purchase wrapped in execute', () => {
    const decision = willSponsor(execute(SALES, buyPacksCall()), SALES);
    expect(decision.allowed).toBe(true);
  });

  it('sponsors a pack purchase wrapped in executeBatch', () => {
    const decision = willSponsor(executeBatch([{ target: SALES, data: buyPacksCall() }]), SALES);
    expect(decision.allowed).toBe(true);
  });

  it('refuses a call to any other contract', () => {
    // The obvious attack: point the sponsored call somewhere else entirely.
    const decision = willSponsor(execute(OTHER, buyPacksCall()), SALES);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/only the pack sales contract/i);
  });

  it('refuses a different function on the right contract', () => {
    // withdraw() on WordPackSales is permissionless. Sponsoring it would mean
    // paying gas for someone else's bookkeeping, and more importantly shows
    // that "right contract" is not sufficient on its own.
    const withdraw = ethers.id('withdraw()').slice(0, 10);
    const decision = willSponsor(execute(SALES, withdraw), SALES);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/only buyPacks/i);
  });

  it('refuses a batch that smuggles one disallowed call among valid ones', () => {
    // Every call has to pass, not just the first or the majority.
    const decision = willSponsor(
      executeBatch([
        { target: SALES, data: buyPacksCall() },
        { target: OTHER, data: buyPacksCall() },
        { target: SALES, data: buyPacksCall() },
      ]),
      SALES
    );
    expect(decision.allowed).toBe(false);
  });

  it('refuses an unrecognised account wrapper', () => {
    // Failing closed on an encoding we cannot read is the only safe default —
    // an unknown wrapper could be hiding anything.
    const decision = willSponsor('0xdeadbeef' + '00'.repeat(64), SALES);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/unrecognised/i);
  });

  it('refuses a bare buyPacks call that is not wrapped at all', () => {
    // A user operation's callData is the account's own encoding. Anything that
    // is not one of the wrappers we decode is not something we can reason
    // about, even when the inner bytes look familiar.
    const decision = willSponsor(buyPacksCall(), SALES);
    expect(decision.allowed).toBe(false);
  });

  it('refuses an empty batch', () => {
    expect(willSponsor(executeBatch([]), SALES).allowed).toBe(false);
  });

  it('refuses malformed callData', () => {
    expect(willSponsor('', SALES).allowed).toBe(false);
    expect(willSponsor('0x', SALES).allowed).toBe(false);
    expect(willSponsor('0xb61d27f6', SALES).allowed).toBe(false);
    // Right selector, garbage payload.
    expect(willSponsor('0xb61d27f6' + 'ff'.repeat(32), SALES).allowed).toBe(false);
  });

  it('refuses everything when the sales contract is not configured', () => {
    // Not yet deployed must mean "sponsor nothing", never "sponsor anything".
    expect(willSponsor(execute(SALES, buyPacksCall()), null).allowed).toBe(false);
    expect(willSponsor(execute(SALES, buyPacksCall()), 'not-an-address').allowed).toBe(false);
  });

  it('compares addresses without regard to checksum casing', () => {
    const decision = willSponsor(execute(SALES.toUpperCase().replace('0X', '0x'), buyPacksCall()), SALES);
    expect(decision.allowed).toBe(true);
  });
});
