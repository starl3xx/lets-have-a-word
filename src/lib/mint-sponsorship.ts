/**
 * The budget that decides whether a Wordmark mint gets its gas paid.
 *
 * Extracted here after three consecutive defects in three commits, all in this
 * handful of lines and all found in review rather than by me:
 *
 *   1. The voucher was READ and left in place, so one issue funded an
 *      unbounded run of sponsored reverts for its whole ten-minute life.
 *   2. Consuming it fixed that and broke honest mints instead: the spend
 *      happened before the upstream paymaster was contacted, so a timeout or a
 *      forwarded error destroyed a voucher the player could not replace.
 *   3. Refunding that spend with a bare INCR could RESURRECT an expired
 *      voucher as a key with no expiry at all, which is a permanent licence to
 *      sponsor a mint that can now only revert.
 *
 * Living in an API route, none of it could be tested without a live Redis. It
 * takes a minimal store interface instead, so the rules are exercised against a
 * fake and the endpoint holds nothing but wiring.
 */

/** Just enough of the Upstash client to express the rules. */
export interface BudgetStore {
  get(key: string): Promise<unknown>;
  ttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/**
 * Redis reports a missing key as -2, a key with no expiry as -1, and 0 for one
 * with under a second left. That last one is the trap: it is neither "gone" nor
 * "no expiry", and treating it as either is wrong in a different way.
 */
const TTL_MISSING = -2;
const TTL_NO_EXPIRY = -1;
const TTL_SUB_SECOND = 0;

/** Ceiling for a key found without one. Never longer than a voucher's life. */
const FALLBACK_TTL_SECONDS = 600;

export function parseBudget(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  const parsed = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Does every one of these vouchers still have budget left? */
export async function hasBudget(store: BudgetStore, keys: string[]): Promise<boolean> {
  for (const key of keys) {
    if (parseBudget(await store.get(key)) <= 0) return false;
  }
  return true;
}

export interface SpendResult {
  /** Every key this call decremented and did not itself compensate. On a
   *  refusal the caller must refund exactly these, and only these. */
  spent: string[];
  ok: boolean;
}

/**
 * Spend one unit against each voucher. THE DECR RESULT IS THE ARBITER.
 *
 * hasBudget is a plain GET and cannot hold under concurrency: N parallel
 * requests all read the same intact budget, and with auto-pipelining they do
 * it in one batched round trip, so the race is deterministic, not a window.
 * The only atomic primitive on this path is the counter itself — a spend
 * counts only if its own DECR lands at zero or above. Exactly
 * MINT_SPONSOR_BUDGET requests can ever win a voucher, whatever the
 * concurrency.
 *
 * Still BEFORE the upstream paymaster is called, because that call is what
 * costs money. Anything that turns out not to have been sponsored is
 * refunded by the caller, from `spent`.
 */
export async function spendBudget(store: BudgetStore, keys: string[]): Promise<SpendResult> {
  const spent: string[] = [];
  for (const key of keys) {
    let left: number;
    try {
      left = await store.decr(key);
    } catch (error) {
      // State unknown: the decrement may or may not have landed, so refunding
      // could conjure a unit that funds a sponsored revert, while not
      // refunding costs the player at most one retry. Take the cheaper loss.
      console.error('[mint-sponsorship] Could not spend a voucher:', error);
      return { ok: false, spent };
    }
    if (left < 0) {
      // Exhausted — or the key expired between the check and this spend, in
      // which case the DECR just re-created it at -1 with NO expiry: the
      // mirror of the INCR resurrection bug refundBudget guards against.
      // refundBudget covers both: an exhausted key goes back to 0 with its
      // own remaining life, a resurrected one gets the fallback expiry, so
      // nothing immortal or spendable is left behind either way.
      await refundBudget(store, [key]);
      return { ok: false, spent };
    }
    spent.push(key);
  }
  return { ok: true, spent };
}

/**
 * Give back a spend that bought nothing.
 *
 * NEVER RESURRECTS AN EXPIRED VOUCHER. `incr` on a missing key creates it with
 * no expiry, so a timeout in the last seconds of a voucher's life would leave a
 * permanent authorisation behind, and the mint it authorises can only revert
 * because the deadline inside the signed voucher has already passed. A lapsed
 * voucher is simply not refunded: there is nothing worth giving back.
 *
 * The expiry is re-applied after every credit, so even losing the race between
 * the TTL read and the increment leaves a key that expires rather than one that
 * lives forever.
 */
export async function refundBudget(store: BudgetStore, keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      const ttl = await store.ttl(key);

      // Gone, or gone within the second. Neither is worth refunding, and a
      // sub-second TTL fell into the fallback below and bought a dying voucher
      // a fresh ten minutes of sponsoring a mint whose onchain deadline had
      // not moved. (Bugbot, PR #300.)
      if (ttl === TTL_MISSING || ttl === TTL_SUB_SECOND) continue;

      await store.incr(key);

      // ONLY a key with no expiry gets the fallback. Everything else gets its
      // own remaining life back, because a refund must never extend a voucher.
      await store.expire(key, ttl === TTL_NO_EXPIRY ? FALLBACK_TTL_SECONDS : ttl);
      if (ttl === TTL_NO_EXPIRY) {
        console.warn('[mint-sponsorship] Voucher key had no expiry; one applied');
      }
    } catch (error) {
      // A voucher left short costs the player a retry. Never let that mask the
      // real failure the caller is already reporting.
      console.error('[mint-sponsorship] Could not refund a voucher:', error);
    }
  }
}
