/**
 * One timezone for everything the admin reads.
 *
 * Every "today", every day bucket, every rendered timestamp in the admin panel
 * resolves to US Central. Nothing else does: the 11:00 UTC daily guess reset,
 * round timing and contract calls are game behaviour and stay UTC. This module
 * is for reporting only.
 *
 * ## Trap 1 — the conversion runs backwards on a naive column
 *
 * Almost every timestamp column in this database is `timestamp without time
 * zone` holding UTC. Postgres does not know that. Writing
 *
 *     created_at AT TIME ZONE 'America/Chicago'
 *
 * on a naive column converts the WRONG WAY — it reads the value as if it were
 * already Central and converts it to UTC, moving it +5h instead of -5h. A ten
 * hour error, which silently files rows under the wrong day and is invisible
 * unless you compare two panels that bucket differently. Exactly that produced
 * the "admin says 1 pack, the game says 6" report on 2026-08-18.
 *
 * The correct form depends on the column, so there are two helpers and you must
 * pick by type. Only FIVE columns in the whole schema are `timestamptz`:
 *
 *     analytics_events.created_at
 *     og_hunter_cast_proofs.verified_at
 *     user_badges.awarded_at
 *     users.added_mini_app_at
 *     xp_events.created_at
 *
 * Everything else is naive. When in doubt, check `information_schema.columns`
 * rather than guessing — guessing is what this module is here to stop.
 *
 * ## Trap 2 — `AT TIME ZONE` on a DATE silently uses the session zone
 *
 * `<date> AT TIME ZONE 'America/Chicago'` does not mean "midnight Central".
 * Postgres prefers the `timezone(text, timestamptz)` overload, so it first
 * casts the date to `timestamptz` using the SESSION's TimeZone, and the answer
 * changes with the server's configuration. Measured:
 *
 *     SET TimeZone='UTC';         DATE '2026-08-18' AT TIME ZONE 'America/Chicago'
 *                                   -> 2026-08-17 19:00:00     (5h out)
 *     SET TimeZone='Asia/Tokyo';  same expression
 *                                   -> 2026-08-17 10:00:00     (14h out)
 *
 * An explicit `::timestamp` picks the right overload. Rather than leave that to
 * each caller, use {@link centralDayStart} / {@link centralDayStartTz}, which
 * return a bound you can compare against a column directly.
 *
 * ## Why the zone is inlined rather than bound
 *
 * The zone is written into the SQL as a literal, not passed as a parameter. A
 * bound parameter makes two textually identical bucket expressions into two
 * different parameter nodes, and Postgres then rejects `GROUP BY` on the
 * expression with "column must appear in the GROUP BY clause". Inlining also
 * means the zone is greppable in the source.
 */

import { sql, type SQL } from 'drizzle-orm';

/**
 * Named zone, never a fixed offset: Central is UTC-5 in summer and UTC-6 in
 * winter, so an offset would be right for half the year.
 */
export const REPORTING_TZ = 'America/Chicago';

/** The zone as a SQL literal. See "Why the zone is inlined" above. */
const TZ = sql.raw(`'${REPORTING_TZ}'`);

/**
 * The Central-time calendar day of a NAIVE (`timestamp without time zone`)
 * column holding UTC. This is almost every column in the schema.
 *
 *     centralDay('created_at')
 *       -> DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')
 */
export function centralDay(column: string): SQL {
  return sql`DATE(${sql.raw(column)} AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})`;
}

/**
 * The Central-time calendar day of a `timestamptz` column. Postgres already
 * knows the instant, so it needs one conversion, not two. Applying
 * {@link centralDay} to one of these is just as wrong as the reverse.
 */
export function centralDayTz(column: string): SQL {
  return sql`DATE(${sql.raw(column)} AT TIME ZONE ${TZ})`;
}

/**
 * The Central local timestamp of a NAIVE UTC column, for display or for
 * `DATE_TRUNC` on something coarser than a day.
 */
export function centralTimestamp(column: string): SQL {
  return sql`(${sql.raw(column)} AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})`;
}

/** Today's date in Central. `CURRENT_TIMESTAMP` is already `timestamptz`. */
export const centralToday: SQL = sql`(CURRENT_TIMESTAMP AT TIME ZONE ${TZ})::date`;

/**
 * A DATE, `days` Central days back. Compare it against another DATE — against
 * a timestamp it hits Trap 2. For a window bound on a timestamp column use
 * {@link centralDayStart} or {@link centralDayStartTz} instead.
 */
export function centralDaysAgo(days: number): SQL {
  return sql`(${centralToday} - ${days}::int)`;
}

/**
 * Midnight Central, `days` days back, as a NAIVE UTC timestamp — ready to
 * compare against a naive column with no further conversion:
 *
 *     WHERE created_at >= ${'${centralDayStart(7)}'}
 *
 * `days` defaults to 0, i.e. the start of today in Central.
 *
 * Prefer this over `NOW() - INTERVAL '7 days'` wherever the rows are then
 * bucketed into days. A rolling window cuts the oldest day in half, so a daily
 * average is taken over N+1 buckets with two of them fractional, and the answer
 * changes on every refresh.
 */
export function centralDayStart(days = 0): SQL {
  return sql`((${centralDaysAgo(days)})::timestamp AT TIME ZONE ${TZ} AT TIME ZONE 'UTC')`;
}

/**
 * Midnight Central, `days` days back, as a `timestamptz` instant — for the five
 * timestamptz columns. Same rules as {@link centralDayStart} otherwise.
 */
export function centralDayStartTz(days = 0): SQL {
  return sql`((${centralDaysAgo(days)})::timestamp AT TIME ZONE ${TZ})`;
}
