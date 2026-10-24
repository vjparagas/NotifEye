import pg from 'pg';
import { config } from './config';

/** Single shared connection pool. Always use parameterized queries (never string-concat SQL). */
export const pool = new pg.Pool({
  connectionString: config.NODE_ENV === 'test' && config.TEST_DATABASE_URL
    ? config.TEST_DATABASE_URL
    : config.DATABASE_URL,
  max: 10,
});

pool.on('error', (err) => {
  // An idle client errored (e.g. the DB restarted). Log it; the pool replaces the client.
  console.error('[db] idle client error:', err.message);
});

export async function closePool(): Promise<void> {
  await pool.end();
}
