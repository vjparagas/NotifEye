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
  type Client,
} from './helpers';
import { pool } from '../src/db';
import { evaluateSessionAttendance } from '../src/modules/attendance/service';
import { runAttendanceSweep } from '../src/modules/scheduler';

async function clearMailpit(): Promise<void> {
  try {
    await fetch('http://127.0.0.1:8025/api/v1/messages', { method: 'DELETE' });
  } catch (err) {
    console.warn('[Test] Could not clear Mailpit messages:', err);
  }
}

async function getMailpitMessages(): Promise<
  Array<{
    ID: string;
    From: { Address: string; Name: string };
    To: Array<{ Address: string; Name: string }>;
    Subject: string;
    Snippet: string;
  }>
> {
  const res = await fetch('http://127.0.0.1:8025/api/v1/messages');
  if (!res.ok) return [];
  const data = (await res.json()) as { messages?: any[] };
  return data.messages || [];
}

describe('Phase 5 Core: Alerts and Email Notifications', () => {
  const app = makeApp();

  beforeEach(async () => {
    await resetDb();
    await clearMailpit();
  });

  async function setupClassWithStudent(profName = 'Prof Ada', studentName = 'Student Bob') {
    const prof = await signUp(app, profName);
    const student = await signUp(app, studentName);
    const cls = await createClass(prof, { name: 'Distributed Systems 101' });

    // Student joins and prof approves
    await join(student, cls.class_code!, true);
    const rosterRes = await prof.get(`/classes/${cls.id}/enrollments`);
    const enr = rosterRes.body.enrollments.find((e: { user_id: string }) => e.user_id === student.user.id);
    await prof.patch(`/classes/${cls.id}/enrollments/${enr.id}`, { status: 'approved' });

    return { prof, student, cls };
  }

  it('creates an ABSENT alert once and delivers an email to Mailpit when grace period ends with no join', async () => {
    const { prof, student, cls } = await setupClassWithStudent();

    // Create session: starts 15 min ago, grace 10 min, ends in 45 min
    const now = new Date();
    const startsAt = new Date(now.getTime() - 15 * 60 * 1000);
    const endsAt = new Date(now.getTime() + 45 * 60 * 1000);

    const sessionRes = await prof.post(`/classes/${cls.id}/sessions`, {
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      meeting_link: 'https://meet.google.com/abc-defg-hij',
      grace_minutes: 10,
    });
    expect(sessionRes.status).toBe(201);
    const session = sessionRes.body.session;

    // Run attendance evaluation at 'now' (15 min after start, > 10 min grace)
    await evaluateSessionAttendance(session.id, pool, now);

    // 1. Verify alert record was inserted
    const { rows: alerts } = await pool.query<{
      id: string;
      class_id: string;
      session_id: string;
      user_id: string;
      kind: string;
      message: string;
      channels_sent: string[];
    }>('SELECT * FROM alerts WHERE session_id = $1', [session.id]);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe('absent');
    expect(alerts[0]!.user_id).toBe(student.user.id);
    expect(alerts[0]!.class_id).toBe(cls.id);
    expect(alerts[0]!.channels_sent).toContain('email');
    expect(alerts[0]!.channels_sent).toContain('dashboard');

    // 2. Verify email landed in Mailpit
    const messages = await getMailpitMessages();
    expect(messages.length).toBeGreaterThanOrEqual(1);

    const email = messages.find((m) =>
      m.To.some((to) => to.Address.toLowerCase() === prof.user.email.toLowerCase()),
    );
    expect(email).toBeDefined();
    expect(email!.Subject).toContain('[NotifEye Alert]');
    expect(email!.Subject).toContain('ABSENT');
    expect(email!.Subject).toContain('Distributed Systems 101');
  });

  it('is idempotent: no duplicate alert and no duplicate email after repeated scheduler runs', async () => {
    const { prof, cls } = await setupClassWithStudent();

    const now = new Date();
    const startsAt = new Date(now.getTime() - 20 * 60 * 1000);
    const endsAt = new Date(now.getTime() + 40 * 60 * 1000);

    const sessionRes = await prof.post(`/classes/${cls.id}/sessions`, {
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      meeting_link: 'https://meet.google.com/abc-defg-hij',
      grace_minutes: 10,
    });
    expect(sessionRes.status).toBe(201);

    // Run scheduler sweep 3 times in a row
    await runAttendanceSweep(now);
    await runAttendanceSweep(now);
    await runAttendanceSweep(now);

    // Verify still exactly 1 alert row
    const { rows: alerts } = await pool.query('SELECT * FROM alerts');
    expect(alerts).toHaveLength(1);

    // Verify Mailpit has only 1 message sent
    const messages = await getMailpitMessages();
    const profEmails = messages.filter((m) =>
      m.To.some((to) => to.Address.toLowerCase() === prof.user.email.toLowerCase()),
    );
    expect(profEmails).toHaveLength(1);
  });

  it('creates a LATE alert and sends email when student joins after the grace period', async () => {
    const { prof, student, cls } = await setupClassWithStudent();

    const now = new Date();
    const startsAt = new Date(now.getTime() - 20 * 60 * 1000);
    const endsAt = new Date(now.getTime() + 40 * 60 * 1000);

    const sessionRes = await prof.post(`/classes/${cls.id}/sessions`, {
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      meeting_link: 'https://meet.google.com/abc-defg-hij',
      grace_minutes: 10,
    });
    const session = sessionRes.body.session;

    // Grace period ends, marks absent
    await evaluateSessionAttendance(session.id, pool, now);

    // Initial Absent alert created
    const { rows: absentAlerts } = await pool.query(
      "SELECT * FROM alerts WHERE kind = 'absent' AND user_id = $1",
      [student.user.id],
    );
    expect(absentAlerts).toHaveLength(1);

    // Student joins after grace period (e.g. 15 minutes after start)
    const joinTime = new Date(startsAt.getTime() + 15 * 60 * 1000);
    const postEventsRes = await student.post('/events', {
      events: [
        {
          user_id: student.user.id,
          class_id: cls.id,
          type: 'meeting_joined',
          timestamp: joinTime.toISOString(),
          source: 'extension',
        },
      ],
    });
    expect(postEventsRes.status).toBe(201);

    // Verify Late alert created
    const { rows: lateAlerts } = await pool.query(
      "SELECT * FROM alerts WHERE kind = 'late' AND user_id = $1",
      [student.user.id],
    );
    expect(lateAlerts).toHaveLength(1);
    expect(lateAlerts[0]!.kind).toBe('late');

    // Verify Mailpit received 2 emails: 1 absent, 1 late
    const messages = await getMailpitMessages();
    const profEmails = messages.filter((m) =>
      m.To.some((to) => to.Address.toLowerCase() === prof.user.email.toLowerCase()),
    );
    expect(profEmails.length).toBe(2);

    const lateEmail = profEmails.find((m) => m.Subject.includes('LATE'));
    expect(lateEmail).toBeDefined();

    // Idempotency: Posting duplicate join event does NOT create a duplicate alert or email
    await student.post('/events', {
      events: [
        {
          user_id: student.user.id,
          class_id: cls.id,
          type: 'meeting_joined',
          timestamp: joinTime.toISOString(),
          source: 'extension',
        },
      ],
    });

    const { rows: lateAlertsAfter } = await pool.query(
      "SELECT * FROM alerts WHERE kind = 'late' AND user_id = $1",
      [student.user.id],
    );
    expect(lateAlertsAfter).toHaveLength(1);
  });

  it('restricts GET /alerts to the professor of that class only and supports marking read', async () => {
    const { prof: profA, student: studentA, cls: clsA } = await setupClassWithStudent('Prof A', 'Student A');
    const { prof: profB, cls: clsB } = await setupClassWithStudent('Prof B', 'Student B');

    // Create session in class A and trigger an absent alert
    const now = new Date();
    const startsAt = new Date(now.getTime() - 20 * 60 * 1000);
    const endsAt = new Date(now.getTime() + 40 * 60 * 1000);

    const sRes = await profA.post(`/classes/${clsA.id}/sessions`, {
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      meeting_link: 'https://meet.google.com/abc-defg-hij',
      grace_minutes: 10,
    });
    await evaluateSessionAttendance(sRes.body.session.id, pool, now);

    // 1. Professor A can see alerts for Class A
    const listA = await profA.get(`/alerts?class_id=${clsA.id}`);
    expect(listA.status).toBe(200);
    expect(listA.body.alerts).toHaveLength(1);
    const alertId = listA.body.alerts[0].id;
    expect(listA.body.alerts[0].read_at).toBeNull();

    // 2. Professor A can see alerts across their own classes without query param
    const allA = await profA.get('/alerts');
    expect(allA.status).toBe(200);
    expect(allA.body.alerts).toHaveLength(1);

    // 3. Professor B (not in class A) gets 404/403 for class A alerts
    const listBforA = await profB.get(`/alerts?class_id=${clsA.id}`);
    expect([403, 404]).toContain(listBforA.status);

    // 4. Professor B sees none of class A's alerts in their general /alerts
    const allB = await profB.get('/alerts');
    expect(allB.status).toBe(200);
    expect(allB.body.alerts).toHaveLength(0);

    // 5. Student A is forbidden from viewing alerts
    const studentAlerts = await studentA.get(`/alerts?class_id=${clsA.id}`);
    expect(studentAlerts.status).toBe(403);

    const studentAllAlerts = await studentA.get('/alerts');
    expect(studentAllAlerts.status).toBe(403);

    // 6. Professor A marks alert as read
    const markRes = await profA.patch(`/alerts/${alertId}/read`);
    expect(markRes.status).toBe(200);
    expect(markRes.body.alert.read_at).not.toBeNull();

    // Re-fetching shows alert is now read
    const afterRead = await profA.get(`/alerts?class_id=${clsA.id}`);
    expect(afterRead.body.alerts[0].read_at).not.toBeNull();

    // 7. Professor B cannot mark Professor A's alert as read
    const foreignMark = await profB.patch(`/alerts/${alertId}/read`);
    expect([403, 404]).toContain(foreignMark.status);
  });
});
