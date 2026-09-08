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
 * So the policy returns `requiresMints` and /api/paymaster must verify each
 * voucher's signer and its Redis budget before forwarding. An `allowed: true` that dropped that
 * field would look finished and quietly reopen the hole, which is what these
 * cases are here to prevent.
 */
const WORDMARKS = '0x3333333333333333333333333333333333333333';
const SIG = '0x' + 'ab'.repeat(65);

function mintCall(signature = SIG, id = 10n): string {
  return (
    WORDMARK_MINT_SELECTOR +
    coder
      .encode(
        ['uint256', 'address', 'uint256', 'uint256', 'bytes'],
        [6500n, OTHER, id, 1_800_000_000n, signature]
      )
      .slice(2)
  );
}

describe('willSponsor: Wordmark mints', () => {
  it('allows a mint but demands the voucher that authorised it', () => {
    const decision = willSponsor(execute(WORDMARKS, mintCall()), SALES, WORDMARKS);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresMints?.map((m) => m.signature)).toEqual([SIG]);
    // The full claim travels so the endpoint can recover the signer and key
    // the budget by entitlement.
    expect(decision.requiresMints?.[0]).toMatchObject({ fid: 6500n, id: 10n, to: OTHER });
  });

  it('demands a voucher for every mint in a batch, not just the first', () => {
    // Two DIFFERENT entitlements: a batch repeating one (fid, id) is refused
    // outright, whatever the signatures say.
    const a = '0x' + '11'.repeat(65);
    const b = '0x' + '22'.repeat(65);
    const decision = willSponsor(
      executeBatch([
        { target: WORDMARKS, data: mintCall(a, 10n) },
        { target: WORDMARKS, data: mintCall(b, 11n) },
      ]),
      SALES,
      WORDMARKS
    );
    expect(decision.requiresMints?.map((m) => m.signature)).toEqual([a, b]);
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
    expect(decision.requiresMints?.map((m) => m.signature)).toEqual([SIG]);
  });

  it('leaves a plain pack purchase needing no voucher at all', () => {
    const decision = willSponsor(execute(SALES, buyPacksCall()), SALES, WORDMARKS);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresMints).toBeUndefined();
  });

  it('refuses a batch that reuses one voucher across several mints', () => {
    // The hole this closes: one legitimately issued voucher, repeated N times
    // in a batch. The contract rejects the replays, so N-1 are guaranteed
    // reverts, and a revert still consumes gas the paymaster pays for.
    // (Bugbot, PR #300.)
    const decision = willSponsor(
      executeBatch([
        { target: WORDMARKS, data: mintCall() },
        { target: WORDMARKS, data: mintCall() },
      ]),
      SALES,
      WORDMARKS
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/mint one Wordmark twice/i);
  });

  it('refuses two GENUINE vouchers for the same entitlement in one batch', () => {
    // The signature-keyed dedupe missed this: the voucher endpoint signs a
    // fresh deadline every request, so one player can hold two real
    // signatures for one Wordmark — and the second mint in the batch can
    // only revert AlreadyMinted. Dedupe follows the budget: by (fid, id).
    // (Bugbot, #321.)
    const decision = willSponsor(
      executeBatch([
        { target: WORDMARKS, data: mintCall('0x' + '11'.repeat(65), 10n) },
        { target: WORDMARKS, data: mintCall('0x' + '22'.repeat(65), 10n) },
      ]),
      SALES,
      WORDMARKS
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/mint one Wordmark twice/i);
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

  it('refuses a signature that is not exactly 65 bytes', () => {
    // Junk can never recover to the attestor; refuse it a layer early rather
    // than letting a two-byte "signature" reach the Redis lookup and logs.
    expect(willSponsor(execute(WORDMARKS, mintCall('0xabcd')), SALES, WORDMARKS).allowed).toBe(false);
    expect(willSponsor(execute(WORDMARKS, mintCall('0x' + 'ab'.repeat(64))), SALES, WORDMARKS).allowed).toBe(false);
  });
});

/**
 * The shapes real clients actually send. Every sponsored call from the app
 * carries the 29-byte ERC-8021 attribution suffix on the INNER calldata
 * (WordmarkMintButton appends it to encodeFunctionData's output), and the
 * decode tolerating those trailing bytes is what every sponsored mint rests
 * on. Nothing pinned it until these cases.
 */
const ERC_8021_SUFFIX = '62635f6c756c34736c64770b0080218021802180218021802180218021';

describe('willSponsor: real client shapes', () => {
  it('sponsors a suffixed mint inside executeBatch, recovering the same signature', () => {
    const decision = willSponsor(
      executeBatch([{ target: WORDMARKS, data: mintCall() + ERC_8021_SUFFIX }]),
      SALES,
      WORDMARKS
    );
    expect(decision.allowed).toBe(true);
    expect(decision.requiresMints?.map((m) => m.signature)).toEqual([SIG]);
  });

  it('sponsors a suffixed pack purchase inside executeBatch', () => {
    const decision = willSponsor(
      executeBatch([{ target: SALES, data: buyPacksCall() + ERC_8021_SUFFIX, value: 400_000_000_000_000n }]),
      SALES,
      WORDMARKS
    );
    expect(decision.allowed).toBe(true);
  });

  it('refuses a batch wider than any honest flow produces', () => {
    const calls = Array.from({ length: 5 }, () => ({ target: SALES, data: buyPacksCall() }));
    const decision = willSponsor(executeBatch(calls), SALES, WORDMARKS);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/batch too large/i);
  });

  it('survives non-string callData from an unauthenticated body', () => {
    // The route feeds this straight from JSON; a number here used to throw on
    // .startsWith and 500 the wallet instead of refusing gracefully.
    expect(willSponsor(42 as unknown as string, SALES, WORDMARKS).allowed).toBe(false);
    expect(willSponsor({} as unknown as string, SALES, WORDMARKS).allowed).toBe(false);
    expect(willSponsor(null as unknown as string, SALES, WORDMARKS).allowed).toBe(false);
  });
});
