import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { config } from '../src/config';
import { pool } from '../src/db';
import type { GoogleIdentity } from '../src/modules/auth/google';
import { CSRF, DASHBOARD_ORIGIN, PASSWORD, makeApp, resetDb, signUp, uniqueEmail } from './helpers';

beforeEach(resetDb);

const register = (app: ReturnType<typeof makeApp>, body: Record<string, unknown> = {}) =>
  request(app)
    .post('/auth/register')
    .send({ email: uniqueEmail(), password: PASSWORD, name: 'Pat', consent: true, client: 'dashboard', ...body });

describe('POST /auth/register', () => {
  it('dashboard: sets an httpOnly session cookie and never puts the token in the body', async () => {
    const app = makeApp();
    const res = await register(app, { email: 'Prof@Example.COM' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user).toMatchObject({ email: 'prof@example.com', name: 'Pat' });
    expect(res.body.user.password_hash).toBeUndefined();

    const cookie = (res.get('Set-Cookie') ?? []).find((c) => c.startsWith('notifeye_session='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  it('extension: returns a bearer token in the body and sets no cookie', async () => {
    const res = await register(makeApp(), { client: 'extension' });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.get('Set-Cookie')).toBeUndefined();
  });

  it('stores a bcrypt hash (not the password) and the consent timestamp + version', async () => {
    const email = uniqueEmail();
    await register(makeApp(), { email, password: 'my secret pass' });
    const { rows } = await pool.query(
      'SELECT password_hash, consent_at, consent_version FROM users WHERE email = $1',
      [email],
    );
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$\d\d\$/);
    expect(rows[0].password_hash).not.toContain('my secret pass');
    expect(rows[0].consent_version).toBeTruthy();
    expect(Date.now() - new Date(rows[0].consent_at).getTime()).toBeLessThan(30_000);
  });

  it('rejects registration without consent and creates no account', async () => {
    const email = uniqueEmail();
    for (const consent of [false, undefined]) {
      const res = await register(makeApp(), { email, consent });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('consent_required');
    }
    const { rowCount } = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    expect(rowCount).toBe(0);
  });

  it('rejects a duplicate email, case-insensitively', async () => {
    const app = makeApp();
    await register(app, { email: 'dup@example.com' });
    const res = await register(app, { email: 'DUP@Example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('email_taken');
  });

  it.each([
    ['bad email', { email: 'not-an-email' }],
    ['short password', { password: 'short' }],
    ['password over 72 bytes', { password: 'x'.repeat(73) }],
    ['empty name', { name: '   ' }],
    ['unknown client', { client: 'mobile' }],
    ['missing client', { client: undefined }],
  ])('validates the body with zod: %s', async (_label, bad) => {
    const res = await register(makeApp(), bad);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it('rejects a non-JSON / empty body with a 400, not a 500', async () => {
    const app = makeApp();
    expect((await request(app).post('/auth/register')).status).toBe(400);
    const bad = await request(app).post('/auth/register').set('Content-Type', 'application/json').send('{oops');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('validation_error');
  });
});

describe('POST /auth/login', () => {
  it('logs in with the right password (dashboard: cookie; extension: token)', async () => {
    const app = makeApp();
    const email = uniqueEmail();
    await register(app, { email });

    const dash = await request(app).post('/auth/login').send({ email, password: PASSWORD, client: 'dashboard' });
    expect(dash.status).toBe(200);
    expect(dash.body.token).toBeUndefined();
    expect((dash.get('Set-Cookie') ?? [])[0]).toMatch(/^notifeye_session=.*HttpOnly/i);

    const ext = await request(app).post('/auth/login').send({ email, password: PASSWORD, client: 'extension' });
    expect(ext.status).toBe(200);
    expect(typeof ext.body.token).toBe('string');
    const me = await request(app).get('/me').set('Authorization', `Bearer ${ext.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('accepts the email in any letter case', async () => {
    const app = makeApp();
    await register(app, { email: 'mixed@example.com' });
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'MIXED@example.com', password: PASSWORD, client: 'extension' });
    expect(res.status).toBe(200);
  });

  it('gives the SAME generic 401 for a wrong password and an unknown email', async () => {
    const app = makeApp();
    const email = uniqueEmail();
    await register(app, { email });

    const wrongPassword = await request(app).post('/auth/login').send({ email, password: 'nope-nope-nope', client: 'extension' });
    const unknownEmail = await request(app)
      .post('/auth/login')
      .send({ email: uniqueEmail('ghost'), password: PASSWORD, client: 'extension' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error).toBe('invalid_credentials');
    expect(wrongPassword.body.token).toBeUndefined();
    expect(wrongPassword.get('Set-Cookie')).toBeUndefined();
  });

  it('validates the body (missing password)', async () => {
    const res = await request(makeApp()).post('/auth/login').send({ email: uniqueEmail(), client: 'extension' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});

describe('sessions, tokens and cookies', () => {
  it('GET /me needs authentication', async () => {
    const app = makeApp();
    expect((await request(app).get('/me')).status).toBe(401);
    expect((await request(app).get('/me').set('Authorization', 'Bearer not.a.token')).status).toBe(401);
    expect((await request(app).get('/me').set('Authorization', 'Basic abc')).status).toBe(401);
  });

  it('rejects expired tokens, wrong-secret tokens and alg=none tokens', async () => {
    const app = makeApp();
    const me = await signUp(app);
    const expired = jwt.sign({}, config.JWT_SECRET, { subject: me.user.id, expiresIn: -10 });
    const forged = jwt.sign({}, 'some-other-secret-value', { subject: me.user.id, expiresIn: 600 });
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: me.user.id })}.`;

    for (const token of [expired, forged, none]) {
      const res = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('stops honouring a token once the account is deleted', async () => {
    const app = makeApp();
    const me = await signUp(app);
    expect((await me.get('/me')).status).toBe(200);
    await pool.query('DELETE FROM users WHERE id = $1', [me.user.id]);
    expect((await me.get('/me')).status).toBe(401);
  });

  it('never falls back to the cookie when a bad Authorization header is sent', async () => {
    const app = makeApp();
    const agent = request.agent(app);
    await agent.post('/auth/register').send({
      email: uniqueEmail(), password: PASSWORD, name: 'Pat', consent: true, client: 'dashboard',
    });
    expect((await agent.get('/me')).status).toBe(200); // cookie alone works
    expect((await agent.get('/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  it('logout clears the session cookie', async () => {
    const app = makeApp();
    const agent = request.agent(app);
    await agent.post('/auth/register').send({
      email: uniqueEmail(), password: PASSWORD, name: 'Pat', consent: true, client: 'dashboard',
    });
    const out = await agent.post('/auth/logout');
    expect(out.status).toBe(204);
    expect((out.get('Set-Cookie') ?? [])[0]).toMatch(/notifeye_session=;/);
    expect((await agent.get('/me')).status).toBe(401);
  });
});

describe('CSRF protection for the cookie session', () => {
  async function dashboardAgent(app: ReturnType<typeof makeApp>) {
    const agent = request.agent(app);
    await agent.post('/auth/register').send({
      email: uniqueEmail(), password: PASSWORD, name: 'Pat', consent: true, client: 'dashboard',
    });
    return agent;
  }
  const body = { name: 'Math 101', platform: 'meet' };

  it('blocks a cookie-authenticated write that lacks the custom header', async () => {
    const agent = await dashboardAgent(makeApp());
    const res = await agent.post('/classes').send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('csrf_check_failed');
  });

  it('blocks a cookie-authenticated write from a foreign Origin even with the header', async () => {
    const agent = await dashboardAgent(makeApp());
    const res = await agent.post('/classes').set(CSRF).set('Origin', 'http://evil.example').send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('csrf_check_failed');
  });

  it('allows the write from the dashboard origin with the header', async () => {
    const agent = await dashboardAgent(makeApp());
    const res = await agent.post('/classes').set(CSRF).set('Origin', DASHBOARD_ORIGIN).send(body);
    expect(res.status).toBe(201);
  });

  it('does not require the header for bearer tokens (not auto-attached by browsers)', async () => {
    const me = await signUp(makeApp());
    expect((await me.post('/classes', body)).status).toBe(201);
  });

  it('does not block reads from the cookie session', async () => {
    const agent = await dashboardAgent(makeApp());
    expect((await agent.get('/classes')).status).toBe(200);
  });
});

describe('credentialed CORS allow-list', () => {
  it('echoes an allowed origin and allows credentials', async () => {
    const res = await request(makeApp())
      .options('/auth/login')
      .set('Origin', DASHBOARD_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe(DASHBOARD_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not grant CORS to an origin that is not on the list', async () => {
    const res = await request(makeApp())
      .options('/auth/login')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limiting of auth routes', () => {
  it('returns 429 once the limit is exceeded', async () => {
    const app = makeApp({ rateLimits: { auth: { limit: 3, windowMs: 60_000 }, join: { limit: 100, windowMs: 60_000 } } });
    const attempt = () =>
      request(app).post('/auth/login').send({ email: uniqueEmail('x'), password: 'whatever-123', client: 'extension' });

    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('rate_limited');
  });

  it('also limits register and google, but not /me', async () => {
    const app = makeApp({ rateLimits: { auth: { limit: 2, windowMs: 60_000 }, join: { limit: 100, windowMs: 60_000 } } });
    expect((await register(app)).status).toBe(201);
    expect((await register(app)).status).toBe(201);
    expect((await register(app)).status).toBe(429);
    expect((await request(app).post('/auth/google').send({ credential: 'x' })).status).toBe(429);
    expect((await request(app).get('/me')).status).toBe(401); // reachable (and unauthenticated), not 429
  });
});

describe('Google sign-in (dashboard only)', () => {
  const identities: Record<string, GoogleIdentity> = {
    newbie: { sub: 'g-111', email: 'newbie@gmail.test', emailVerified: true, name: 'New Bie' },
    unverified: { sub: 'g-222', email: 'shady@gmail.test', emailVerified: false, name: 'Shady' },
  };
  const verifier = vi.fn(async (credential: string) => {
    const id = identities[credential] ?? (credential.startsWith('email:')
      ? { sub: `g-${credential}`, email: credential.slice(6), emailVerified: true, name: 'Linked' }
      : undefined);
    if (!id) throw new Error('invalid token');
    return id;
  });
  const google = (app: ReturnType<typeof makeApp>, body: object) => request(app).post('/auth/google').send(body);

  it('is disabled (501) when no Google client is configured', async () => {
    const res = await google(makeApp({ googleVerifier: null }), { credential: 'newbie', consent: true });
    expect(res.status).toBe(501);
    expect(res.body.error).toBe('google_sign_in_disabled');
  });

  it('a brand-new Google user must consent; the account then gets a consent timestamp', async () => {
    const app = makeApp({ googleVerifier: verifier });
    const noConsent = await google(app, { credential: 'newbie' });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.error).toBe('consent_required');
    expect((await pool.query('SELECT 1 FROM users')).rowCount).toBe(0);

    const ok = await google(app, { credential: 'newbie', consent: true });
    expect(ok.status).toBe(201);
    expect(ok.body.token).toBeUndefined();
    expect((ok.get('Set-Cookie') ?? [])[0]).toMatch(/HttpOnly/i);
    const { rows } = await pool.query('SELECT google_sub, password_hash, consent_at FROM users');
    expect(rows[0].google_sub).toBe('g-111');
    expect(rows[0].password_hash).toBeNull();
    expect(rows[0].consent_at).not.toBeNull();
  });

  it('a returning Google user signs in without being asked for consent again', async () => {
    const app = makeApp({ googleVerifier: verifier });
    await google(app, { credential: 'newbie', consent: true });
    const again = await google(app, { credential: 'newbie' });
    expect(again.status).toBe(200);
    expect((await pool.query('SELECT 1 FROM users')).rowCount).toBe(1);
  });

  it('links an existing password account that has the same verified email', async () => {
    const app = makeApp({ googleVerifier: verifier });
    await register(app, { email: 'same@example.com' });
    const res = await google(app, { credential: 'email:same@example.com' });
    expect(res.status).toBe(200);
    const { rows } = await pool.query('SELECT google_sub, password_hash FROM users');
    expect(rows).toHaveLength(1);
    expect(rows[0].google_sub).toBe('g-email:same@example.com');
    expect(rows[0].password_hash).not.toBeNull();
  });

  it('rejects an unverified Google email and an invalid token', async () => {
    const app = makeApp({ googleVerifier: verifier });
    const unverified = await google(app, { credential: 'unverified', consent: true });
    expect(unverified.status).toBe(401);
    expect(unverified.body.error).toBe('google_token_invalid');
    const bad = await google(app, { credential: 'garbage', consent: true });
    expect(bad.status).toBe(401);
    expect((await pool.query('SELECT 1 FROM users')).rowCount).toBe(0);
  });

  it('never hands the extension a token: Google always yields a cookie, even if client=extension is sent', async () => {
    const app = makeApp({ googleVerifier: verifier });
    const res = await google(app, { credential: 'newbie', consent: true, client: 'extension' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeUndefined();
  });

  it('a Google-only account cannot be logged into with a password', async () => {
    const app = makeApp({ googleVerifier: verifier });
    await google(app, { credential: 'newbie', consent: true });
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'newbie@gmail.test', password: PASSWORD, client: 'extension' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });
});
