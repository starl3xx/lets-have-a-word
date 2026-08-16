/**
 * Typefully transport tests
 *
 * postViaTypefully is the transport only — postTweet owns the production
 * gating (twitterIsActive), which setup-guards keeps disarmed under test.
 * These tests drive the transport against a mocked fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postViaTypefully, convertToTwitterText } from '../lib/twitter';

const realFetch = global.fetch;

beforeEach(() => {
  process.env.TYPEFULLY_API_KEY = 'test-key';
  process.env.TYPEFULLY_SOCIAL_SET_ID = '326839';
});

afterEach(() => {
  delete process.env.TYPEFULLY_API_KEY;
  delete process.env.TYPEFULLY_SOCIAL_SET_ID;
  global.fetch = realFetch;
});

describe('postViaTypefully', () => {
  it('creates a publish-now draft in the social set and returns the draft id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 9912, status: 'draft', publish_state: 'in_progress' }), {
        status: 201,
      })
    );
    global.fetch = fetchMock as any;

    const result = await postViaTypefully('🟣 Round 34 is live');

    expect(result).toEqual({ id: 'typefully:9912' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.typefully.com/v2/social-sets/326839/drafts');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.publish_at).toBe('now');
    expect(body.platforms.x.enabled).toBe(true);
    expect(body.platforms.x.posts).toEqual([{ text: '🟣 Round 34 is live' }]);
  });

  it('returns null on an API error instead of throwing', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'forbidden', message: 'bad key' } }), {
        status: 403,
      })
    ) as any;

    expect(await postViaTypefully('text')).toBeNull();
  });

  it('returns null on a network failure instead of throwing', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as any;
    expect(await postViaTypefully('text')).toBeNull();
  });

  it('returns null without calling fetch when no key is configured', async () => {
    delete process.env.TYPEFULLY_API_KEY;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    expect(await postViaTypefully('text')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('convertToTwitterText still feeds the new transport', () => {
  it('maps the Farcaster handle to the X handle', () => {
    expect(convertToTwitterText('Play @letshaveaword now')).toBe('Play @letshaveaword_ now');
  });
});
