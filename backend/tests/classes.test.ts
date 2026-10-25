import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { CLASS_CODE_ALPHABET, CLASS_CODE_LENGTH } from '@notifeye/shared';
import { pool } from '../src/db';
import { createClass, join, makeApp, resetDb, signUp } from './helpers';

beforeEach(resetDb);

describe('POST /classes', () => {
  it('creates a class; the creator becomes an approved professor of THAT class', async () => {
    const app = makeApp();
    const prof = await signUp(app, 'Prof');
    const cls = await createClass(prof, { name: 'SIA101', section: 'B', platform: 'zoom' });

    expect(cls).toMatchObject({ name: 'SIA101', section: 'B', platform: 'zoom', role: 'professor', status: 'approved' });
    expect(cls.class_code).toHaveLength(CLASS_CODE_LENGTH);
    for (const ch of cls.class_code!) expect(CLASS_CODE_ALPHABET).toContain(ch);

    const { rows } = await pool.query('SELECT role, status FROM enrollments WHERE user_id = $1', [prof.user.id]);
    expect(rows).toEqual([{ role: 'professor', status: 'approved' }]);
  });

  it('generates a different code for every class', async () => {
    const prof = await signUp(makeApp());
    const codes = new Set<string>();
    for (let i = 0; i < 15; i++) codes.add((await createClass(prof, { name: `C${i}` })).class_code!);
    expect(codes.size).toBe(15);
  });

  it('requires authentication', async () => {
    expect((await request(makeApp()).post('/classes').send({ name: 'X', platform: 'zoom' })).status).toBe(401);
  });

  it.each([
    ['missing name', { name: undefined }],
    ['blank name', { name: '  ' }],
    ['unsupported platform (Teams is out of scope)', { platform: 'teams' }],
    ['non-Discord webhook URL', { discord_webhook_url: 'https://evil.example/hook' }],
    ['http Discord webhook URL', { discord_webhook_url: 'http://discord.com/api/webhooks/1/abc' }],
  ])('validates the body with zod: %s', async (_label, bad) => {
    const prof = await signUp(makeApp());
    const res = await prof.post('/classes', { name: 'Math', platform: 'meet', ...bad });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('only the OWNING professor ever receives discord_webhook_url', async () => {
    const app = makeApp();
    const prof = await signUp(app, 'Prof');
    const student = await signUp(app, 'Stu');
    const hook = 'https://discord.com/api/webhooks/123456789/abc_DEF-123';
    const cls = await createClass(prof, { discord_webhook_url: hook });
    expect(cls.discord_webhook_url).toBe(hook); // owner sees it
    await join(student, cls.class_code!);

    const asOwner = await prof.get(`/classes/${cls.id}`);
    expect(asOwner.body.class.discord_webhook_url).toBe(hook);

    const asStudent = await student.get(`/classes/${cls.id}`);
    expect(asStudent.status).toBe(200);
    expect('discord_webhook_url' in asStudent.body.class).toBe(false);
    expect(JSON.stringify(asStudent.body)).not.toContain('discord.com');
    expect(JSON.stringify((await student.get('/classes')).body)).not.toContain('discord.com');
    expect(JSON.stringify((await prof.get('/classes')).body)).not.toContain('discord.com'); // never in lists
  });

  it('never writes the webhook URL (or a password) to the logs, even when the request fails', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m));
    const app = makeApp();
    const prof = await signUp(app);
    const hook = 'https://discord.com/api/webhooks/987654321/secret_token';
    await createClass(prof, { discord_webhook_url: hook });
    await prof.post('/classes', { name: '', platform: 'meet', discord_webhook_url: hook }); // 400
    await request(app).post('/auth/login').send({ email: 'a@b.test', password: 'hunter2hunter2', client: 'extension' });

    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain('secret_token');
    expect(logged).not.toContain('hunter2hunter2');
    spies.forEach((s) => s.mockRestore());
  });
});

describe('POST /classes/join', () => {
  it('joins with a valid code: PENDING student, with a consent timestamp; the student never sees the code', async () => {
    const app = makeApp();
    const prof = await signUp(app, 'Prof');
    const student = await signUp(app, 'Stu');
    const cls = await createClass(prof);

    const res = await join(student, cls.class_code!);
    expect(res.status).toBe(201);
    expect(res.body.class).toMatchObject({ id: cls.id, role: 'student', status: 'pending', class_code: null });

    const { rows } = await pool.query(
      'SELECT role, status, consent_at FROM enrollments WHERE user_id = $1 AND class_id = $2',
      [student.user.id, cls.id],
    );
    expect(rows[0]).toMatchObject({ role: 'student', status: 'pending' });
    expect(Date.now() - new Date(rows[0].consent_at).getTime()).toBeLessThan(30_000);
  });

  it('REQUIRES consent: without it the join is refused and nothing is stored', async () => {
    const app = makeApp();
    const prof = await signUp(app);
    const student = await signUp(app);
    const cls = await createClass(prof);

    for (const consent of [false, undefined]) {
      const res = await student.post('/classes/join', { class_code: cls.class_code, consent });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('consent_required');
    }
    const { rowCount } = await pool.query('SELECT 1 FROM enrollments WHERE user_id = $1', [student.user.id]);
    expect(rowCount).toBe(0);
  });

  it('an INVALID code returns the same generic 404 every time and creates nothing', async () => {
    const app = makeApp();
    const student = await signUp(app);
    const prof = await signUp(app);
    const cls = await createClass(prof);

    const bodies = new Set<string>();
    for (const code of ['ZZZZZZZZ', 'nope', 'ABCD-EFGH', '1', cls.class_code!.slice(0, -1), `${cls.class_code}X`, "' OR 1=1 --"]) {
      const res = await join(student, code);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'not_found', message: 'Class not found' });
      bodies.add(JSON.stringify(res.body));
    }
    expect(bodies.size).toBe(1); // indistinguishable: no oracle for "almost right" codes
    expect((await pool.query('SELECT 1 FROM enrollments WHERE user_id = $1', [student.user.id])).rowCount).toBe(0);
  });

  it('rejects an empty code with a validation error', async () => {
    const student = await signUp(makeApp());
    const res = await student.post('/classes/join', { class_code: '   ', consent: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('accepts the code in lower case or with spaces/dashes', async () => {
    const app = makeApp();
    const prof = await signUp(app);
    const cls = await createClass(prof);
    const code = cls.class_code!;
    const student = await signUp(app);
    const res = await join(student, `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`);
    expect(res.status).toBe(201);
  });

  it('is idempotent: joining twice does not duplicate or reset the enrollment', async () => {
    const app = makeApp();
    const prof = await signUp(app);
    const student = await signUp(app);
    const cls = await createClass(prof);
    expect((await join(student, cls.class_code!)).status).toBe(201);
    expect((await join(student, cls.class_code!)).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM enrollments WHERE user_id = $1', [student.user.id])).rowCount).toBe(1);
  });

  it('does not let a removed student rejoin by code', async () => {
    const app = makeApp();
    const prof = await signUp(app);
    const student = await signUp(app);
    const cls = await createClass(prof);
    await join(student, cls.class_code!);
    const roster = await prof.get(`/classes/${cls.id}/enrollments`);
    const eid = roster.body.enrollments.find((e: { user_id: string }) => e.user_id === student.user.id).id;
    await prof.patch(`/classes/${cls.id}/enrollments/${eid}`, { status: 'removed' });

    const again = await join(student, cls.class_code!);
    expect(again.status).toBe(403);
    expect(again.body.error).toBe('removed_from_class');
  });

  it('requires authentication', async () => {
    const res = await request(makeApp()).post('/classes/join').send({ class_code: 'ABCD2345', consent: true });
    expect(res.status).toBe(401);
  });

  it('is rate-limited per user (code guessing), without affecting other users', async () => {
    const app = makeApp({ rateLimits: { auth: { limit: 1000, windowMs: 60_000 }, join: { limit: 3, windowMs: 60_000 } } });
    const guesser = await signUp(app);
    const bystander = await signUp(app);

    for (let i = 0; i < 3; i++) expect((await join(guesser, `WRONG${i}XX`)).status).toBe(404);
    const limited = await join(guesser, 'WRONG9XX');
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('rate_limited');

    expect((await join(bystander, 'WRONG1XX')).status).toBe(404); // different user: own budget
  });
});

describe('GET /classes (roles are per class, never global)', () => {
  it('the same account is a professor in one class and a student in another', async () => {
    const app = makeApp();
    const alex = await signUp(app, 'Alex');
    const bea = await signUp(app, 'Bea');
    const alexsClass = await createClass(alex, { name: 'Alex teaches this' });
    const beasClass = await createClass(bea, { name: 'Bea teaches this' });
    await join(alex, beasClass.class_code!);

    const res = await alex.get('/classes');
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.classes.map((c: { name: string }) => [c.name, c]));
    expect(byName['Alex teaches this']).toMatchObject({ id: alexsClass.id, role: 'professor', status: 'approved' });
    expect(byName['Alex teaches this'].class_code).toBe(alexsClass.class_code);
    expect(byName['Bea teaches this']).toMatchObject({ role: 'student', status: 'pending', class_code: null });
  });
});
