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
