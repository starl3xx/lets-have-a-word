import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { willSponsor, BUY_PACKS_SELECTOR, WORDMARK_MINT_SELECTOR } from './paymaster-policy';

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
    // Wording only: the policy sponsors two contracts now, so the refusal no
    // longer names the sales contract as the sole permitted one. The behaviour
    // this test exists for is the line above.
    expect(decision.reason).toMatch(/not a sponsored contract/i);
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

/**
 * Wordmark mints, the first widening of this policy since it was written.
 *
 * The trap: A REVERTING TRANSACTION STILL CONSUMES GAS THE PAYMASTER PAYS FOR.
 * The Wordmarks contract reverts on a replayed mint, by design, so "targets our
 * contract and calls mint" is not a sufficient rule on its own — anybody could
 * loop failed mints and drain the balance without ever receiving a token.
 *
 * So the policy returns `requiresVouchers` and /api/paymaster must check each
 * one against Redis before forwarding. An `allowed: true` that dropped that
 * field would look finished and quietly reopen the hole, which is what these
 * cases are here to prevent.
 */
const WORDMARKS = '0x3333333333333333333333333333333333333333';
const SIG = '0x' + 'ab'.repeat(65);

function mintCall(signature = SIG): string {
  return (
    WORDMARK_MINT_SELECTOR +
    coder
      .encode(
        ['uint256', 'address', 'uint256', 'uint256', 'bytes'],
        [6500n, OTHER, 10n, 1_800_000_000n, signature]
      )
      .slice(2)
  );
}

describe('willSponsor: Wordmark mints', () => {
  it('allows a mint but demands the voucher that authorised it', () => {
    const decision = willSponsor(execute(WORDMARKS, mintCall()), SALES, WORDMARKS);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresVouchers).toEqual([SIG]);
  });

  it('demands a voucher for every mint in a batch, not just the first', () => {
    const a = '0x' + '11'.repeat(65);
    const b = '0x' + '22'.repeat(65);
    const decision = willSponsor(
      executeBatch([
        { target: WORDMARKS, data: mintCall(a) },
        { target: WORDMARKS, data: mintCall(b) },
      ]),
      SALES,
      WORDMARKS
    );
    expect(decision.requiresVouchers).toEqual([a, b]);
  });

  it('carries the requirement out of a batch that also buys packs', () => {
    const decision = willSponsor(
      executeBatch([
        { target: SALES, data: buyPacksCall() },
        { target: WORDMARKS, data: mintCall() },
      ]),
      SALES,
      WORDMARKS
    );
    expect(decision.allowed).toBe(true);
    expect(decision.requiresVouchers).toEqual([SIG]);
  });

  it('leaves a plain pack purchase needing no voucher at all', () => {
    const decision = willSponsor(execute(SALES, buyPacksCall()), SALES, WORDMARKS);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresVouchers).toBeUndefined();
  });

  it('refuses a batch that reuses one voucher across several mints', () => {
    // The hole this closes: one legitimately issued voucher, repeated N times
    // in a batch. The contract rejects the replays, so N-1 are guaranteed
    // reverts, and a revert still consumes gas the paymaster pays for. Every
    // signature passed the Redis check, because they were all the same
    // signature. (Bugbot, PR #300.)
    const decision = willSponsor(
      executeBatch([
        { target: WORDMARKS, data: mintCall() },
        { target: WORDMARKS, data: mintCall() },
      ]),
      SALES,
      WORDMARKS
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/reuse one Wordmark voucher/i);
  });

  it('refuses a mint whose arguments do not decode', () => {
    const decision = willSponsor(
      execute(WORDMARKS, WORDMARK_MINT_SELECTOR + 'aabb'),
      SALES,
      WORDMARKS
    );
    expect(decision.allowed).toBe(false);
  });

  it('refuses any other function on the Wordmarks contract', () => {
    // setAttestor is onlyOwner, so this would revert — and a revert is exactly
    // what costs the paymaster money for nothing.
    const setAttestor =
      ethers.id('setAttestor(address)').slice(0, 10) + coder.encode(['address'], [OTHER]).slice(2);
    const decision = willSponsor(execute(WORDMARKS, setAttestor), SALES, WORDMARKS);
    expect(decision.allowed).toBe(false);
  });

  it('refuses mints before the contract is configured', () => {
    // Unset must mean "sponsor nothing", never "sponsor anything".
    expect(willSponsor(execute(WORDMARKS, mintCall()), SALES, null).allowed).toBe(false);
    expect(willSponsor(execute(WORDMARKS, mintCall()), SALES, 'nope').allowed).toBe(false);
  });
});
