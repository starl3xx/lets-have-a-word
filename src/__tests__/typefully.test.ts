/**
 * Typefully transport tests
 *
 * postViaTypefully is the transport only — postTweet owns the production
 * gating (twitterIsActive), which setup-guards keeps disarmed under test.
 * These tests drive the transport against a mocked fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postViaTypefully, convertToTwitterText, getTypefullyPublishedUrl } from '../lib/twitter';

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
      new Response(
        JSON.stringify({
          id: 9912,
          status: 'draft',
          publish_state: 'in_progress',
          private_url: 'https://typefully.com/draft/9912',
        }),
        { status: 201 }
      )
    );
    global.fetch = fetchMock as any;

    const result = await postViaTypefully('🟣 Round 34 is live');

    expect(result).toEqual({
      id: 'typefully:9912',
      url: 'https://typefully.com/draft/9912',
      draftId: 9912,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.typefully.com/v2/social-sets/326839/drafts');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    // NEVER 'now' — Typefully 403s direct publishing of URL-bearing X posts
    // (X policy); a short schedule goes through their own pipeline instead.
    // This assertion is the regression guard for round 34's silent launch
    // tweet failure.
    expect(body.publish_at).not.toBe('now');
    const publishAt = new Date(body.publish_at).getTime();
    expect(publishAt).toBeGreaterThan(Date.now());
    expect(publishAt).toBeLessThan(Date.now() + 10 * 60 * 1000);
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

describe('getTypefullyPublishedUrl', () => {
  it('returns the x.com URL once publishing is finished', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 9912,
          publish_state: 'finished',
          x_published_url: 'https://x.com/letshaveaword_/status/123',
        }),
        { status: 200 }
      )
    ) as any;
    expect(await getTypefullyPublishedUrl(9912)).toBe(
      'https://x.com/letshaveaword_/status/123'
    );
  });

  it('returns null while publishing is still in progress', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: 9912, publish_state: 'in_progress', x_published_url: null }),
        { status: 200 }
      )
    ) as any;
    expect(await getTypefullyPublishedUrl(9912)).toBeNull();
  });

  it('returns null on API errors instead of throwing', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as any;
    expect(await getTypefullyPublishedUrl(9912)).toBeNull();
  });
});

describe('convertToTwitterText still feeds the new transport', () => {
  it('maps the Farcaster handle to the X handle', () => {
    expect(convertToTwitterText('Play @letshaveaword now')).toBe('Play @letshaveaword_ now');
  });
});
