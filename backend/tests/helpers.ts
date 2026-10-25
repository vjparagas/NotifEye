import request from 'supertest';
import type { Express } from 'express';
import type { ClassDetailDTO, UserDTO } from '@notifeye/shared';
import { createApp, type AppOptions } from '../src/app';
import { pool } from '../src/db';

export const DASHBOARD_ORIGIN = 'http://localhost:5173';
export const CSRF = { 'X-Requested-With': 'NotifEye-Dashboard' } as const;

/** Generous limits so ordinary tests never trip the limiters; rate-limit tests pass tiny ones. */
const HIGH = { limit: 10_000, windowMs: 60_000 };

export function makeApp(options: AppOptions = {}): Express {
  return createApp({
    googleVerifier: null,
    rateLimits: { auth: HIGH, join: HIGH },
    ...options,
  });
}

/** Wipes all application data. Refuses to touch any database whose name does not end in _test. */
export async function resetDb(): Promise<void> {
  const { rows } = await pool.query<{ db: string }>('SELECT current_database() AS db');
  if (!rows[0]!.db.endsWith('_test')) throw new Error(`resetDb() refused: "${rows[0]!.db}" is not a test database`);
  // Every other table references users (directly or not), so CASCADE clears the whole schema data.
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}${counter}-${Date.now()}@test.example`;
}

export const PASSWORD = 'correct horse battery';

/** A signed-in extension-style client (bearer token). */
export interface Client {
  token: string;
  user: UserDTO;
  get: (path: string) => request.Test;
  post: (path: string, body?: object) => request.Test;
  patch: (path: string, body?: object) => request.Test;
}

export function clientFor(app: Express, token: string, user: UserDTO): Client {
  const auth = (t: request.Test) => t.set('Authorization', `Bearer ${token}`);
  return {
    token,
    user,
    get: (p) => auth(request(app).get(p)),
    post: (p, b) => auth(request(app).post(p)).send(b ?? {}),
    patch: (p, b) => auth(request(app).patch(p)).send(b ?? {}),
  };
}

/** Registers an account through the real endpoint and returns a bearer-token client. */
export async function signUp(app: Express, name = 'Test User', email = uniqueEmail()): Promise<Client> {
  const res = await request(app)
    .post('/auth/register')
    .send({ email, password: PASSWORD, name, consent: true, client: 'extension' });
  if (res.status !== 201) throw new Error(`signUp failed: ${res.status} ${JSON.stringify(res.body)}`);
  return clientFor(app, res.body.token as string, res.body.user as UserDTO);
}

export async function createClass(
  client: Client,
  body: Record<string, unknown> = {},
): Promise<ClassDetailDTO> {
  const res = await client.post('/classes', { name: 'Math 101', section: 'A', platform: 'meet', ...body });
  if (res.status !== 201) throw new Error(`createClass failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.class as ClassDetailDTO;
}

/** Student joins by code (with consent) and returns the response. */
export function join(client: Client, code: string, consent = true): request.Test {
  return client.post('/classes/join', { class_code: code, consent });
}
