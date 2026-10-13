import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestQuickAuthToken } from './hostActions';

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
