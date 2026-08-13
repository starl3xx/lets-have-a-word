import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import * as dotenv from 'dotenv';

dotenv.config();

type Db = ReturnType<typeof drizzle<typeof schema>>;

let cached: Db | null = null;

/**
 * Build the connection on first use.
 *
 * This used to run at module scope and throw when DATABASE_URL was unset, which
 * meant merely *importing* anything downstream of this file crashed. Nine test
 * files failed at collection for that reason — including `rate-limit.test.ts`,
 * which makes no database calls at all and only reached this file through an
 * import chain. They therefore never ran, in CI or locally.
 *
 * The error is unchanged, just deferred to the first query. Anything that
 * genuinely touches the database still fails exactly as loudly as before; the
 * difference is that not touching it is now survivable.
 */
function connect(): Db {
  if (cached) return cached;

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  cached = drizzle(postgres(process.env.DATABASE_URL), { schema });
  return cached;
}

/**
 * Drizzle client. Behaves exactly like the eagerly-constructed instance it
 * replaces — every property access forwards to the real client, connecting on
 * the first one.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const value = Reflect.get(connect() as object, prop, receiver);
    return typeof value === 'function' ? value.bind(connect()) : value;
  },
  has(_target, prop) {
    return Reflect.has(connect() as object, prop);
  },
});

// Export schema for convenience
export * from './schema';
