import './setup';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import {
  makeApp,
  resetDb,
  signUp,
  createClass,
  join,
  DASHBOARD_ORIGIN,
  CSRF,
  PASSWORD,
  uniqueEmail,
} from './helpers';
import { pool } from '../src/db';

describe('Privacy Export: GET /me/data', () => {
  const app = makeApp();

  beforeEach(async () => {
    await resetDb();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/me/data');
    expect(res.status).toBe(401);
  });

  it('works with a bearer token and never exposes password_hash', async () => {
    const client = await signUp(app, 'Alice Student');
    const res = await client.get('/me/data');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();

    const { user, enrollments, attendance, events } = res.body.data;
    expect(user.id).toBe(client.user.id);
    expect(user.email).toBe(client.user.email);
    expect(user.name).toBe('Alice Student');
    expect(user.consent_at).toBeDefined();

    // Must never contain password_hash or password in response
    expect('password_hash' in user).toBe(false);
    expect('password' in user).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('password_hash');

    expect(Array.isArray(enrollments)).toBe(true);
    expect(Array.isArray(attendance)).toBe(true);
    expect(Array.isArray(events)).toBe(true);
  });

  it('works with a cookie session', async () => {
    const email = uniqueEmail('cookie-user');
    const regRes = await request(app)
      .post('/auth/register')
      .send({ email, password: PASSWORD, name: 'Cookie User', consent: true, client: 'dashboard' });
    const cookie = regRes.headers['set-cookie'];
    expect(cookie).toBeDefined();

    const res = await request(app)
      .get('/me/data')
      .set('Cookie', cookie!);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.name).toBe('Cookie User');
  });

  it('strictly isolates data: user A cannot see user B’s attendance, events, or enrollments', async () => {
    const prof = await signUp(app, 'Prof Turing');
    const studentA = await signUp(app, 'Student A');
    const studentB = await signUp(app, 'Student B');

    // Create a class and sessions
    const cls = await createClass(prof, { name: 'Operating Systems' });

    // Both join
    await join(studentA, cls.class_code!, true);
    await join(studentB, cls.class_code!, true);

    // Approve both
    const roster = await prof.get(`/classes/${cls.id}/enrollments`);
    for (const enr of roster.body.enrollments) {
      await prof.patch(`/classes/${cls.id}/enrollments/${enr.id}`, { status: 'approved' });
    }

    // Create a session
    const sessRes = await prof.post(`/classes/${cls.id}/sessions`, {
      starts_at: '2026-10-25T14:00:00.000Z',
      ends_at: '2026-10-25T15:00:00.000Z',
      meeting_link: 'https://meet.google.com/abc-defg-hij',
    });
    const sessionId = sessRes.body.session.id;

    // Student A submits events and attendance
    await studentA.post('/events', {
      events: [
        {
          user_id: studentA.user.id,
          class_id: cls.id,
          type: 'meeting_joined',
          timestamp: '2026-10-25T14:02:00.000Z',
          source: 'extension',
        },
        {
          user_id: studentA.user.id,
          class_id: cls.id,
          type: 'presence',
          state: 'active',
          timestamp: '2026-10-25T14:03:00.000Z',
          source: 'extension',
        },
      ],
    });

    // Student B exports data
    const resB = await studentB.get('/me/data');
    expect(resB.status).toBe(200);
    const dataB = resB.body.data;

    // Student B sees only their user info
    expect(dataB.user.id).toBe(studentB.user.id);
    expect(dataB.user.name).toBe('Student B');

    // Student B should have NO attendance records and NO activity events
    expect(dataB.attendance).toHaveLength(0);
    expect(dataB.events).toHaveLength(0);

    // Student A exports data
    const resA = await studentA.get('/me/data');
    expect(resA.status).toBe(200);
    const dataA = resA.body.data;

    // Student A sees their attendance and events
    expect(dataA.user.id).toBe(studentA.user.id);
    expect(dataA.attendance).toHaveLength(1);
    expect(dataA.attendance[0].session_id).toBe(sessionId);
    expect(dataA.events).toHaveLength(2);

    // Ensure student A sees none of student B's data
    const allAString = JSON.stringify(dataA);
    expect(allAString).not.toContain(studentB.user.id);
    expect(allAString).not.toContain('Student B');
  });
});
