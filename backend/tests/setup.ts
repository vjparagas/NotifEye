/** Per-test-file setup. Runs BEFORE the test file imports anything that reads the config. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });

process.env.NODE_ENV = 'test'; // makes src/db.ts use TEST_DATABASE_URL
process.env.BCRYPT_ROUNDS = '4'; // speed only; production default is 12
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.GOOGLE_CLIENT_ID = ''; // tests inject a stub verifier; never talk to Google

afterAll(async () => {
  const { closePool } = await import('../src/db');
  await closePool();
});
