/**
 * POST /api/auth/siwe — wallet sign-in, end to end.
 *
 * The signature check itself is mocked. That is deliberate, not a shortcut:
 * viem's `verifySiweMessage` performs an `eth_call` so it can validate the
 * ERC-1271/6492 signatures Base Account smart wallets produce, and this repo
 * has been bitten before by a test file that quietly started talking to
 * mainnet (see the note in src/__tests__/setup-guards.ts). viem tests its own
 * cryptography; what needs testing here is everything wrapped around it —
 * nonce consumption, the domain binding, the upsert, and the cookie.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockVerify, mockNonce } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockNonce: vi.fn(),
}));

vi.mock('viem/siwe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem/siwe')>();
  return { ...actual, verifySiweMessage: mockVerify };
});

vi.mock('../../pages/api/auth/nonce', () => ({
  __esModule: true,
  default: () => {},
  verifyAndConsumeNonce: mockNonce,
}));

import handler from '../../pages/api/auth/siwe';
import { verifyPlayerSession, PLAYER_SESSION_COOKIE } from '../lib/playerSession';
import { db } from '../db';
import { users } from '../db/schema';
import { inArray, sql } from 'drizzle-orm';

const SECRET = 'test-secret-not-a-real-one';
const originalSecret = process.env.ADMIN_SECRET;

/** A well-formed SIWE message for the domain under test. */
function siweMessage(opts: { address: string; domain?: string; nonce?: string }) {
  const domain = opts.domain ?? 'letshaveaword.fun';
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    opts.address,
    '',
    'Sign in to Let’s Have A Word!',
    '',
    `URI: https://${domain}`,
    'Version: 1',
    'Chain ID: 8453',
    `Nonce: ${opts.nonce ?? 'abc123def456'}`,
    `Issued At: 2026-08-26T00:00:00.000Z`,
  ].join('\n');
}

function run(body: unknown, method = 'POST') {
  return new Promise<{ status: number; body: any; cookie?: string }>((resolve) => {
    let status = 200;
    let cookie: string | undefined;
    const res = {
      status(c: number) {
        status = c;
        return this;
      },
      json(payload: unknown) {
        resolve({ status, body: payload, cookie });
        return this;
      },
      setHeader(k: string, v: string) {
        if (k === 'Set-Cookie') cookie = v;
        return this;
      },
      end() {
        return this;
      },
    };
    handler({ method, body } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  });
}

const createdWallets: string[] = [];
function freshAddress(tag: string): string {
  const n = (process.hrtime.bigint() % 10n ** 12n).toString().padStart(12, '0');
  const addr = `0x${tag.padEnd(28, '0').slice(0, 28)}${n}`.toLowerCase();
  createdWallets.push(addr);
  return addr;
}

beforeEach(() => {
  process.env.ADMIN_SECRET = SECRET;
  mockVerify.mockReset().mockResolvedValue(true);
  mockNonce.mockReset().mockResolvedValue(true);
});

afterEach(async () => {
  if (originalSecret === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = originalSecret;

  if (createdWallets.length) {
    await db.delete(users).where(
      inArray(sql`lower(${users.signerWalletAddress})`, createdWallets)
    );
    createdWallets.length = 0;
  }
});

describe('a good signature', () => {
  it('creates the player, mints a session, and returns their FID', async () => {
    const address = freshAddress('a1');
    const { status, body, cookie } = await run({
      message: siweMessage({ address }),
      signature: '0xdeadbeef',
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.wallet).toBe(address);
    expect(body.fid).toBeGreaterThanOrEqual(1_000_000_000);

    // The cookie must be unreadable by page scripts and survive arriving from
    // a cast embed or a Base App link, which SameSite=Strict would drop.
    expect(cookie).toContain(`${PLAYER_SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');

    const token = cookie!.split(';')[0].split('=').slice(1).join('=');
    const session = await verifyPlayerSession(token, SECRET);
    expect(session).toMatchObject({ fid: body.fid, origin: 'wallet', wallet: address });
  });

  it('returns the same FID on a second sign-in', async () => {
    const address = freshAddress('a2');
    const msg = siweMessage({ address });
    const first = await run({ message: msg, signature: '0x1' });
    const second = await run({ message: msg, signature: '0x1' });
    expect(second.body.fid).toBe(first.body.fid);
  });

  it('consumes the nonce BEFORE verifying, so replays cannot hammer the RPC', async () => {
    const address = freshAddress('a3');
    mockNonce.mockResolvedValue(false);
    const { status } = await run({ message: siweMessage({ address }), signature: '0x1' });

    expect(status).toBe(400);
    expect(mockNonce).toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });
});

describe('refusals', () => {
  it('rejects a signature bound to another site', async () => {
    // The cryptography would be perfectly valid — it is consent to a different
    // thing. Without this check a signature harvested by any other dapp would
    // sign its holder straight in here.
    const address = freshAddress('b1');
    const { status, body } = await run({
      message: siweMessage({ address, domain: 'evil.example' }),
      signature: '0x1',
    });
    expect(status).toBe(401);
    expect(body.error).toMatch(/not for this site/i);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature', async () => {
    const address = freshAddress('b2');
    mockVerify.mockResolvedValue(false);
    const { status, body } = await run({ message: siweMessage({ address }), signature: '0x1' });
    expect(status).toBe(401);
    expect(body.error).toMatch(/invalid signature/i);
  });

  it('rejects a malformed message', async () => {
    const { status } = await run({ message: 'not a siwe message', signature: '0x1' });
    expect(status).toBe(400);
  });

  it('rejects missing fields', async () => {
    expect((await run({ message: 'x' })).status).toBe(400);
    expect((await run({ signature: '0x1' })).status).toBe(400);
  });

  it('refuses to mint anything with no server secret', async () => {
    delete process.env.ADMIN_SECRET;
    const address = freshAddress('b3');
    const { status } = await run({ message: siweMessage({ address }), signature: '0x1' });
    expect(status).toBe(503);
  });

  it('refuses non-POST', async () => {
    expect((await run({}, 'GET')).status).toBe(405);
  });
});
