import './setup';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import {
  makeApp,
  resetDb,
  signUp,
  createClass,
  join,
} from './helpers';
import { pool } from '../src/db';
import {
  computeReminderTime,
  shouldScheduleReminder,
  planSessionReminders,
  REMINDER_ALARM_PREFIX,
} from '@notifeye/shared';

describe('Step 1: Student Attendance History (GET /me/attendance) & Reminder Planning', () => {
  const app = makeApp();

  beforeEach(async () => {
    await resetDb();
  });

  describe('1. Pure Reminder-Time Functions', () => {
    it('computeReminderTime computes exactly 10 minutes before session start', () => {
      const startsAt = '2026-10-26T10:00:00.000Z';
      const reminderTime = computeReminderTime(startsAt, 10);
      expect(reminderTime.toISOString()).toBe('2026-10-26T09:50:00.000Z');

      // Works with Date instance
      const dateStart = new Date('2026-10-26T14:30:00.000Z');
      expect(computeReminderTime(dateStart, 10).toISOString()).toBe('2026-10-26T14:20:00.000Z');

      // Works with timestamp number
      const tsStart = new Date('2026-10-26T12:00:00.000Z').getTime();
      expect(computeReminderTime(tsStart, 10).toISOString()).toBe('2026-10-26T11:50:00.000Z');
    });

    it('shouldScheduleReminder returns true only when reminder time is in the future', () => {
      const startsAt = '2026-10-26T10:00:00.000Z'; // Reminder time is 09:50:00.000Z

      // Case 1: 09:40 (10 minutes before reminder time, 20m before class) -> in future -> true
      expect(shouldScheduleReminder(startsAt, new Date('2026-10-26T09:40:00.000Z'), 10)).toBe(true);

      // Case 2: 09:49:59 (1s before reminder time) -> in future -> true
      expect(shouldScheduleReminder(startsAt, new Date('2026-10-26T09:49:59.000Z'), 10)).toBe(true);

      // Case 3: Exactly on reminder time (09:50:00) -> not strictly in future -> false
      expect(shouldScheduleReminder(startsAt, new Date('2026-10-26T09:50:00.000Z'), 10)).toBe(false);

      // Case 4: After reminder time (09:55:00) -> in past -> false
      expect(shouldScheduleReminder(startsAt, new Date('2026-10-26T09:55:00.000Z'), 10)).toBe(false);
    });

    it('planSessionReminders formats alarm names and messages without side effects', () => {
      const now = new Date('2026-10-26T08:00:00.000Z');
      const sessions = [
        {
          id: 'sess-1',
          class_name: 'Operating Systems',
          starts_at: '2026-10-26T08:05:00.000Z', // Reminder time: 07:55 (past)
          ends_at: '2026-10-26T09:00:00.000Z',
        },
        {
          id: 'sess-2',
          class_name: 'Algorithms',
          starts_at: '2026-10-26T09:00:00.000Z', // Reminder time: 08:50 (future)
          ends_at: '2026-10-26T10:00:00.000Z',
        },
      ];

      const plan = planSessionReminders(sessions, now, 10);
      expect(plan).toHaveLength(2);

      const p0 = plan[0]!;
      const p1 = plan[1]!;

      // sess-1: past reminder
      expect(p0.sessionId).toBe('sess-1');
      expect(p0.alarmName).toBe(`${REMINDER_ALARM_PREFIX}sess-1`);
      expect(p0.message).toBe('Operating Systems starts in 10 minutes');
      expect(p0.scheduled).toBe(false);

      // sess-2: future reminder
      expect(p1.sessionId).toBe('sess-2');
      expect(p1.alarmName).toBe(`${REMINDER_ALARM_PREFIX}sess-2`);
      expect(p1.message).toBe('Algorithms starts in 10 minutes');
      expect(p1.scheduled).toBe(true);
      expect(p1.reminderTime.toISOString()).toBe('2026-10-26T08:50:00.000Z');
    });
  });

  describe('2. Backend GET /me/attendance', () => {
    it('requires authentication (rejects with 401 when no token/cookie)', async () => {
      const res = await request(app).get('/me/attendance');
      expect(res.status).toBe(401);
    });

    it('returns only the caller’s attendance records and never another user’s records', async () => {
      const prof = await signUp(app, 'Prof Turing');
      const studentA = await signUp(app, 'Student Alice');
      const studentB = await signUp(app, 'Student Bob');

      const cls = await createClass(prof, { name: 'CompSci 101' });

      // Enroll both students
      await join(studentA, cls.class_code!);
      await join(studentB, cls.class_code!);
      await pool.query(
        `UPDATE enrollments SET status = 'approved' WHERE class_id = $1`,
        [cls.id],
      );

      // Create session 1
      const s1Res = await prof.post(`/classes/${cls.id}/sessions`, {
        starts_at: '2026-10-26T10:00:00.000Z',
        ends_at: '2026-10-26T11:00:00.000Z',
        meeting_link: 'https://meet.google.com/abc-defg-hij',
        grace_minutes: 5,
      });
      const session1Id = s1Res.body.session.id;

      // Student A joins session 1 (present)
      await studentA.post('/events', {
        events: [
          {
            user_id: studentA.user.id,
            class_id: cls.id,
            session_id: session1Id,
            type: 'meeting_joined',
            state: null,
            timestamp: '2026-10-26T10:02:00.000Z',
            source: 'extension',
          },
        ],
      });

      // Insert an absent record for student B in session 1
      await pool.query(
        `INSERT INTO attendance_records (session_id, user_id, status, source)
         VALUES ($1, $2, 'absent', 'extension')`,
        [session1Id, studentB.user.id],
      );

      // Query GET /me/attendance as Student A
      const resA = await studentA.get('/me/attendance');
      expect(resA.status).toBe(200);
      expect(Array.isArray(resA.body.attendance)).toBe(true);
      expect(resA.body.attendance).toHaveLength(1);

      const recordA = resA.body.attendance[0];
      expect(recordA.session_id).toBe(session1Id);
      expect(recordA.class_name).toBe('CompSci 101');
      expect(recordA.status).toBe('present');
      expect(recordA.source).toBe('extension');

      // Query GET /me/attendance as Student B
      const resB = await studentB.get('/me/attendance');
      expect(resB.status).toBe(200);
      expect(resB.body.attendance).toHaveLength(1);
      const recordB = resB.body.attendance[0];
      expect(recordB.session_id).toBe(session1Id);
      expect(recordB.class_name).toBe('CompSci 101');
      expect(recordB.status).toBe('absent');

      // Student A never sees Student B's attendance
      expect(resA.body.attendance.some((r: any) => r.id === recordB.id)).toBe(false);
    });

    it('returns newest records first and respects the 20-record limit', async () => {
      const prof = await signUp(app, 'Prof Knuth');
      const student = await signUp(app, 'Student Multi');
      const cls = await createClass(prof, { name: 'Data Structures' });
      await join(student, cls.class_code!);
      await pool.query(`UPDATE enrollments SET status = 'approved' WHERE class_id = $1`, [cls.id]);

      // Create 25 sessions and attendance records
      for (let i = 1; i <= 25; i++) {
        const day = i < 10 ? `0${i}` : `${i}`;
        const startsAt = `2026-10-${day}T10:00:00.000Z`;
        const endsAt = `2026-10-${day}T10:50:00.000Z`;

        const { rows: sRows } = await pool.query<{ id: string }>(
          `INSERT INTO class_sessions (class_id, starts_at, ends_at, meeting_link, grace_minutes)
           VALUES ($1, $2, $3, $4, 5) RETURNING id`,
          [cls.id, startsAt, endsAt, `https://meet.google.com/meet-${i}`],
        );
        const sId = sRows[0]!.id;

        await pool.query(
          `INSERT INTO attendance_records (session_id, user_id, status, source)
           VALUES ($1, $2, $3, 'extension')`,
          [sId, student.user.id, i % 2 === 0 ? 'present' : 'late'],
        );
      }

      const res = await student.get('/me/attendance');
      expect(res.status).toBe(200);
      expect(res.body.attendance).toHaveLength(20);

      // Verify sorted newest first (starts_at descending)
      const dates = res.body.attendance.map((r: any) => new Date(r.starts_at).getTime());
      for (let j = 0; j < dates.length - 1; j++) {
        expect(dates[j]).toBeGreaterThanOrEqual(dates[j + 1]);
      }
    });
  });
});
