/**
 * Every admin analytics endpoint must actually execute its SQL.
 *
 * This exists because `retention.ts` and `cohorts.ts` shipped selecting
 * `guesses.user_fid` — a column that has never existed; the table has `fid`.
 * Both endpoints failed on every single request, the Retention and Cohort
 * panels were empty for as long as they had been deployed, and nothing caught
 * it: the queries are raw SQL, so TypeScript cannot see the column name, and no
 * test ever ran them. `cohorts.ts` additionally called
 * `EXTRACT(EPOCH FROM (date - date))`, which has no integer overload.
 *
 * A unit test per metric would not have caught either one. Executing the query
 * does. These assert only that each handler runs its SQL and answers — the
 * shape of the numbers is the panels' business, not this file's.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

import cohorts from '../../pages/api/admin/analytics/cohorts';
import dashboardSummary from '../../pages/api/admin/analytics/dashboard-summary';
import economy from '../../pages/api/admin/analytics/economy';
import gameplay from '../../pages/api/admin/analytics/gameplay';
import onboarding from '../../pages/api/admin/analytics/onboarding';
import packPricing from '../../pages/api/admin/analytics/pack-pricing';
import retention from '../../pages/api/admin/analytics/retention';
import shareFunnel from '../../pages/api/admin/analytics/share-funnel';
import wordToken from '../../pages/api/admin/analytics/word-token';

type Handler = (req: NextApiRequest, res: NextApiResponse) => unknown | Promise<unknown>;

interface Outcome {
  status: number;
  body: unknown;
}

async function run(handler: Handler, query: Record<string, string> = {}): Promise<Outcome> {
  const outcome: Outcome = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      outcome.status = code;
      return this;
    },
    json(payload: unknown) {
      outcome.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
    end() {
      return this;
    },
  };

  await handler(
    {
      method: 'GET',
      // Every one of these endpoints gates on an admin FID before it queries.
      // 6500 is a built-in default admin, so this needs no env setup.
      query: { devFid: '6500', ...query },
      headers: {},
      cookies: {},
      body: {},
    } as unknown as NextApiRequest,
    res as unknown as NextApiResponse
  );
  return outcome;
}

/** Surfaces the endpoint's own error text instead of a bare "expected 500 to be 200". */
function expectRan({ status, body }: Outcome, name: string) {
  const detail =
    status === 200
      ? ''
      : ` — ${name} responded ${status}: ${JSON.stringify(body)?.slice(0, 300)}`;
  expect(status, `${name} should execute its SQL${detail}`).toBe(200);
}

const ENDPOINTS: Array<[string, Handler, Record<string, string>?]> = [
  ['cohorts', cohorts as Handler],
  ['dashboard-summary', dashboardSummary as Handler],
  ['economy', economy as Handler, { days: '7' }],
  ['gameplay', gameplay as Handler, { days: '7' }],
  ['onboarding', onboarding as Handler],
  ['pack-pricing', packPricing as Handler],
  ['retention', retention as Handler],
  ['share-funnel', shareFunnel as Handler, { days: '7' }],
  ['word-token', wordToken as Handler, { days: '7' }],
];

/**
 * Every one of these endpoints returns 503 "Analytics not enabled." before it
 * touches the database unless the flag is on — which is how a broken query
 * could sit unnoticed. Turning it on is the whole point of the suite.
 */
const originalFlag = process.env.ANALYTICS_ENABLED;
beforeAll(() => {
  process.env.ANALYTICS_ENABLED = 'true';
});
afterAll(() => {
  if (originalFlag === undefined) delete process.env.ANALYTICS_ENABLED;
  else process.env.ANALYTICS_ENABLED = originalFlag;
});

describe('admin analytics endpoints execute their SQL', () => {
  for (const [name, handler, query] of ENDPOINTS) {
    it(`${name} runs`, async () => {
      expectRan(await run(handler, query ?? {}), name);
    });
  }
});

describe('Central-time buckets do not depend on the server timezone', () => {
  /**
   * The day boundaries are pinned to America/Chicago in SQL. If any of them
   * leaked into the session's TimeZone instead, these two runs would disagree
   * for rows near midnight. Vercel runs UTC; a developer's machine does not.
   */
  it('dashboard-summary returns the same today-metrics under a different TZ', async () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const utc = await run(dashboardSummary as Handler);
      process.env.TZ = 'Asia/Tokyo';
      const tokyo = await run(dashboardSummary as Handler);

      expectRan(utc, 'dashboard-summary (UTC)');
      expectRan(tokyo, 'dashboard-summary (Asia/Tokyo)');
      expect((tokyo.body as { today?: unknown })?.today).toEqual(
        (utc.body as { today?: unknown })?.today
      );
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
