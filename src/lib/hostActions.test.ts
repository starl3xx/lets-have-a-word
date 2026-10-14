import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  requestQuickAuthToken,
  requestFarcasterFallbackSession,
  forgetFarcasterFallbackSession,
  type HostSignIn,
} from './hostActions';

/**
 * requestQuickAuthToken is asked for a token on every Farcaster guess, so it
 * must never throw and never hang: either outcome would leave the guess button
 * spinning with the player's paid guesses stuck behind it.
 */
describe('requestQuickAuthToken', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the token and hands it to onToken', async () => {
    const onToken = vi.fn();
    const token = await requestQuickAuthToken(async () => ({ token: 'jwt' }), onToken);
    expect(token).toBe('jwt');
    expect(onToken).toHaveBeenCalledWith('jwt');
  });

  it('returns null when the auth server fails, as /verify-siwf did on 2026-10-13', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onToken = vi.fn();
    const token = await requestQuickAuthToken(
      async () => {
        throw new Error('Request failed with status 500');
      },
      onToken
    );
    expect(token).toBeNull();
    expect(onToken).not.toHaveBeenCalled();
  });

  it('returns null for an empty token instead of sending one', async () => {
    const onToken = vi.fn();
    expect(await requestQuickAuthToken(async () => ({ token: '' }), onToken)).toBeNull();
    expect(onToken).not.toHaveBeenCalled();
  });

  it('returns null when getToken throws before returning a promise', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const token = await requestQuickAuthToken(() => {
      throw new Error('sync');
    }, vi.fn());
    expect(token).toBeNull();
  });

  it('gives up at the timeout, and still keeps a token that arrives late', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let answer!: (value: { token: string }) => void;
    const onToken = vi.fn();

    const result = requestQuickAuthToken(
      () => new Promise((resolve) => (answer = resolve)),
      onToken,
      1_000
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toBeNull();

    answer({ token: 'late-jwt' });
    await vi.runAllTimersAsync();
    expect(onToken).toHaveBeenCalledWith('late-jwt');
  });
});

/**
 * The guess path's sign-in when Quick Auth is down. It must never throw, and it
 * must never hand back a session for an account other than the one on screen.
 */
describe('requestFarcasterFallbackSession', () => {
  const FID = 4242;

  /** A stand-in for our two auth routes. */
  function fakeServer(opts: { fid?: number; verifyStatus?: number; nonceStatus?: number } = {}) {
    const { fid = FID, verifyStatus = 200, nonceStatus = 200 } = opts;
    const bodies: Record<string, unknown>[] = [];
    let issued = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/nonce') {
        issued += 1;
        return new Response(JSON.stringify({ nonce: `nonce${issued}` }), { status: nonceStatus });
      }
      if (url === '/api/auth/verify') {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({ success: verifyStatus === 200, fid, sessionToken: `session-${issued}` }),
          { status: verifyStatus }
        );
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    return { fetchImpl, bodies };
  }

  const hostSignIn = () =>
    vi.fn<HostSignIn>(async ({ nonce }) => ({ message: `signed ${nonce}`, signature: '0xsig' }));

  beforeEach(() => {
    forgetFarcasterFallbackSession();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('has the host sign our nonce, and returns the session our server gives', async () => {
    const { fetchImpl, bodies } = fakeServer();
    const signIn = hostSignIn();

    const token = await requestFarcasterFallbackSession(signIn, FID, { fetchImpl, referrerFid: 9 });

    expect(token).toBe('session-1');
    expect(signIn).toHaveBeenCalledWith({ nonce: 'nonce1', acceptAuthAddress: true });
    expect(bodies[0]).toEqual({
      message: 'signed nonce1',
      signature: '0xsig',
      nonce: 'nonce1',
      playerSession: true,
      ref: 9,
    });
  });

  it('refuses a session for an FID the page does not show', async () => {
    const { fetchImpl } = fakeServer({ fid: FID + 1 });
    expect(await requestFarcasterFallbackSession(hostSignIn(), FID, { fetchImpl })).toBeNull();
  });

  it('returns null when our server refuses the signature', async () => {
    const { fetchImpl } = fakeServer({ verifyStatus: 401 });
    expect(await requestFarcasterFallbackSession(hostSignIn(), FID, { fetchImpl })).toBeNull();
  });

  it('returns null without asking the host when no nonce is issued', async () => {
    const { fetchImpl } = fakeServer({ nonceStatus: 503 });
    const signIn = hostSignIn();
    expect(await requestFarcasterFallbackSession(signIn, FID, { fetchImpl })).toBeNull();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('returns null when the player or the host refuses to sign', async () => {
    const { fetchImpl } = fakeServer();
    const signIn = vi.fn<HostSignIn>(async () => {
      throw new Error('SignIn.RejectedByUser');
    });
    expect(await requestFarcasterFallbackSession(signIn, FID, { fetchImpl })).toBeNull();
  });

  it('reuses the session until five minutes before it expires, then signs again', async () => {
    const { fetchImpl } = fakeServer();
    const signIn = hostSignIn();
    let clock = 1_000_000;
    const now = () => clock;

    expect(await requestFarcasterFallbackSession(signIn, FID, { fetchImpl, now })).toBe('session-1');
    clock += 54 * 60 * 1000;
    expect(await requestFarcasterFallbackSession(signIn, FID, { fetchImpl, now })).toBe('session-1');
    expect(signIn).toHaveBeenCalledTimes(1);

    clock += 2 * 60 * 1000;
    expect(await requestFarcasterFallbackSession(signIn, FID, { fetchImpl, now })).toBe('session-2');
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it('does not reuse one player’s session for another FID', async () => {
    const first = fakeServer();
    await requestFarcasterFallbackSession(hostSignIn(), FID, { fetchImpl: first.fetchImpl });

    const second = fakeServer({ fid: FID + 1 });
    const signIn = hostSignIn();
    await requestFarcasterFallbackSession(signIn, FID + 1, { fetchImpl: second.fetchImpl });
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('signs again after the session is forgotten', async () => {
    const { fetchImpl } = fakeServer();
    const signIn = hostSignIn();

    await requestFarcasterFallbackSession(signIn, FID, { fetchImpl });
    forgetFarcasterFallbackSession();
    expect(await requestFarcasterFallbackSession(signIn, FID, { fetchImpl })).toBe('session-2');
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it('joins a sign-in in flight instead of starting a second one', async () => {
    const { fetchImpl } = fakeServer();
    const signIn = hostSignIn();

    const [a, b] = await Promise.all([
      requestFarcasterFallbackSession(signIn, FID, { fetchImpl }),
      requestFarcasterFallbackSession(signIn, FID, { fetchImpl }),
    ]);

    expect([a, b]).toEqual(['session-1', 'session-1']);
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // one nonce, one verify
  });

  it('after a timeout, a second tap joins the open prompt and spends no second nonce', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fakeServer();
    let sign!: () => void;
    const signIn = vi.fn<HostSignIn>(
      ({ nonce }) =>
        new Promise((resolve) => {
          sign = () => resolve({ message: `signed ${nonce}`, signature: '0xsig' });
        })
    );

    const first = requestFarcasterFallbackSession(signIn, FID, { fetchImpl, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await first).toBeNull();

    const retry = requestFarcasterFallbackSession(signIn, FID, { fetchImpl, timeoutMs: 1_000 });
    sign();
    expect(await retry).toBe('session-1');
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('waits past 8 seconds by default, for a host that prompts the player', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fakeServer();
    let sign!: () => void;
    const signIn = vi.fn<HostSignIn>(
      ({ nonce }) =>
        new Promise((resolve) => {
          sign = () => resolve({ message: `signed ${nonce}`, signature: '0xsig' });
        })
    );

    const result = requestFarcasterFallbackSession(signIn, FID, { fetchImpl });
    await vi.advanceTimersByTimeAsync(20_000);
    sign();
    expect(await result).toBe('session-1');
  });

  it('gives up at the timeout, and keeps a session that arrives late', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fakeServer();
    let sign!: () => void;
    const signIn = vi.fn<HostSignIn>(
      ({ nonce }) =>
        new Promise((resolve) => {
          sign = () => resolve({ message: `signed ${nonce}`, signature: '0xsig' });
        })
    );

    const result = requestFarcasterFallbackSession(signIn, FID, { fetchImpl, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toBeNull();

    sign();
    await vi.runAllTimersAsync();
    expect(await requestFarcasterFallbackSession(signIn, FID, { fetchImpl })).toBe('session-1');
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
