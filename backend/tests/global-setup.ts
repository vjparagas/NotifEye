/**
 * Runs once before all test files: applies the migrations to the TEST database (`notifeye_test`,
 * created by docker/postgres-init). It refuses to run against anything that is not a *_test database.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function setup(): void {
  loadDotenv({ path: path.resolve(backendDir, '../.env'), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example).');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${dbName}": the test database name must end with _test.`);
  }

  const cli = [
    path.resolve(backendDir, '../node_modules/node-pg-migrate/bin/node-pg-migrate.js'),
    path.resolve(backendDir, 'node_modules/node-pg-migrate/bin/node-pg-migrate.js'),
  ].find((p) => existsSync(p));
  if (!cli) throw new Error('node-pg-migrate CLI not found; run `npm install` at the repo root.');

  execFileSync(
    process.execPath,
    [cli, 'up', '--migrations-dir', 'migrations', '--migration-file-language', 'sql'],
    { cwd: backendDir, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' },
  );
}
