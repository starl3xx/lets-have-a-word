/**
 * The share bonus, and the auth that had to land with it.
 *
 * This endpoint hands out a free guess every day, forever. It used to read
 * `fid` straight out of the request body — anyone could POST any FID — and the
 * only thing making that survivable was the Neynar cast check: you also had to
 * have actually cast, which you cannot do on someone else's behalf.
 *
 * A wallet player cannot cast at all, so their bonus has to be awarded on the
 * share INTENT. Doing that without authenticating the caller first would have
 * converted the endpoint into an unauthenticated "+1 free guess for any FID"
 * faucet, pointed at the 5,303 dormant accounts from the round-28 farm wave.
 * So the auth is not a nice-to-have here, it is the precondition, and these
 * tests exist to stop it being quietly removed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../pages/api/share-callback';
import { signPlayerSession, PLAYER_SESSION_COOKIE } from '../lib/playerSession';
import { WALLET_FID_MIN } from '../lib/wallet-fid';

const SECRET = 'test-secret-not-a-real-one';
const originalSecret = process.env.ADMIN_SECRET;

beforeEach(() => {
  process.env.ADMIN_SECRET = SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = originalSecret;
  vi.restoreAllMocks();
});

function run(init: {
  body?: Record<string, unknown>;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    let status = 200;
    const res = {
      status(c: number) {
        status = c;
        return this;
      },
      json(body: unknown) {
        resolve({ status, body });
        return this;
      },
      setHeader() {
        return this;
      },
      end() {
        resolve({ status, body: null });
        return this;
      },
    };
    handler(
      {
        method: 'POST',
        body: init.body ?? {},
        cookies: init.cookies ?? {},
        headers: init.headers ?? {},
        query: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );
  });
}

describe('an unauthenticated caller cannot claim anybody a bonus', () => {
  it('refuses a bare fid in the body — the old faucet shape', async () => {
    // Precisely what the endpoint used to accept, and what would have become a
    // free guess for any of 5,303 dormant accounts once the cast check no
    // longer stood in the way.
    const { status, body } = await run({ body: { fid: 6500 } });

    expect(status).toBe(401);
    expect(body.ok).toBe(false);
  });

  it('refuses a request with no credential at all', async () => {
    const { status } = await run({});
    expect(status).toBe(401);
  });

  it('refuses a forged wallet session', async () => {
    const forged = await signPlayerSession(
      { fid: WALLET_FID_MIN + 5, origin: 'wallet', wallet: '0x00000000000000000000000000000000000000aa' },
      'not-the-real-secret'
    );
    const { status } = await run({ cookies: { [PLAYER_SESSION_COOKIE]: forged } });
    expect(status).toBe(401);
  });

  it('refuses a client-asserted miniAppFid, which proves nothing', async () => {
    const { status } = await run({ body: { miniAppFid: 6500 } });
    expect(status).toBe(401);
  });
});

describe('the branch is where they shared, not who they are', () => {
  /**
   * The interaction between account linking and the share bonus, and the worst
   * possible one: after linking, a veteran playing in Base App resolves to
   * their REAL Farcaster fid with playerOrigin 'farcaster'. An identity-based
   * test would then demand a cast they cannot make from Base App and quietly
   * cost them the daily bonus — exactly the players the link flow exists to
   * keep. (Bugbot, PR #295.)
   *
   * `auth.origin` is the honest discriminator and cannot be claimed by the
   * client: a Quick Auth token can only be minted by a Farcaster host, and a
   * player session is SIWE-derived, so it means off-host whichever identity it
   * now names.
   *
   * ASSERTS THE RESPONSE, not a spy. A first version used vi.spyOn on the
   * farcaster module and passed even with the bug restored — a direct ESM
   * import cannot be intercepted that way, so the assertion was vacuous. The
   * observable difference is what the caller is told.
   */
  it('does not demand a cast from a LINKED player whose session names a Farcaster fid', async () => {
    // A FRESH fid per run. The handler early-returns 200 "already claimed"
    // once hasSharedToday is set, so a fixed fid makes this test pass on its
    // second run no matter what the branch does — which is exactly how the
    // first two versions of it were vacuous.
    const fid = 900_000_000 + Number(process.hrtime.bigint() % 50_000_000n);
    const token = await signPlayerSession(
      // Exactly what link-redeem mints: a player session naming the Farcaster
      // account, carrying the wallet they proved.
      { fid, origin: 'farcaster', wallet: '0x00000000000000000000000000000000000000bb' },
      SECRET
    );

    const { status, body } = await run({ cookies: { [PLAYER_SESSION_COOKIE]: token } });

    // The bonus is actually AWARDED. The identity-keyed version instead went
    // looking for a cast — which in any environment without Neynar throws, and
    // in production would simply never be found — so this player was denied a
    // bonus they cannot possibly satisfy.
    expect(status).toBe(200);
    expect(body?.ok).toBe(true);
  });
});
