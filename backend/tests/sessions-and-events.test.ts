import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import {
  createClass,
  join,
  makeApp,
  resetDb,
  signUp,
  type Client,
} from './helpers';
import { pool } from '../src/db';

describe('Phase 3A Backend: Sessions, Schedule, Events, and Status', () => {
  let app: Express;
  let prof: Client;
  let student: Client;

  beforeEach(async () => {
    app = makeApp();
    await resetDb();
    prof = await signUp(app, 'Prof Turing');
    student = await signUp(app, 'Student Maria');
  });

  describe('Session Management (POST/GET /classes/:id/sessions)', () => {
    it('allows the class professor to create and list sessions', async () => {
      const cls = await createClass(prof, { name: 'Networks 101', platform: 'zoom' });

      const startsAt = '2026-10-25T14:00:00.000Z';
      const endsAt = '2026-10-25T15:30:00.000Z';
      const meetingLink = 'https://zoom.us/wc/12345678901/join';

      const createRes = await prof.post(`/classes/${cls.id}/sessions`, {
        starts_at: startsAt,
        ends_at: endsAt,
        meeting_link: meetingLink,
        grace_minutes: 15,
      });

      expect(createRes.status).toBe(201);
      expect(createRes.body.session.class_id).toBe(cls.id);
      expect(createRes.body.session.meeting_id).toBe('12345678901');
      expect(createRes.body.session.grace_minutes).toBe(15);

      // List sessions
      const listRes = await prof.get(`/classes/${cls.id}/sessions`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.sessions).toHaveLength(1);
      expect(listRes.body.sessions[0].id).toBe(createRes.body.session.id);
    });

    it('rejects invalid session dates and negative grace period', async () => {
      const cls = await createClass(prof);

      // ends_at <= starts_at
      const res1 = await prof.post(`/classes/${cls.id}/sessions`, {
        starts_at: '2026-10-25T15:00:00.000Z',
        ends_at: '2026-10-25T14:00:00.000Z',
        meeting_link: 'https://meet.google.com/abc-defg-hij',
      });
      expect(res1.status).toBe(400);

      // negative grace
      const res2 = await prof.post(`/classes/${cls.id}/sessions`, {
        starts_at: '2026-10-25T14:00:00.000Z',
        ends_at: '2026-10-25T15:00:00.000Z',
        meeting_link: 'https://meet.google.com/abc-defg-hij',
        grace_minutes: -5,
      });
      expect(res2.status).toBe(400);
    });

    it('denies students from creating sessions (403)', async () => {
      const cls = await createClass(prof);
      await join(student, cls.class_code!);

      const res = await student.post(`/classes/${cls.id}/sessions`, {
        starts_at: '2026-10-25T14:00:00.000Z',
        ends_at: '2026-10-25T15:00:00.000Z',
        meeting_link: 'https://meet.google.com/abc-defg-hij',
      });
      expect(res.status).toBe(403);
    });
  });

  describe('Student Schedule (GET /me/schedule)', () => {
    it('returns sessions only for approved enrollments', async () => {
      const cls = await createClass(prof);
      const enrollRes = await join(student, cls.class_code!);
      const enrollmentId = enrollRes.body.class.id;

      // Create a session
      await prof.post(`/classes/${cls.id}/sessions`, {
        starts_at: '2026-10-25T14:00:00.000Z',
        ends_at: '2026-10-25T15:00:00.000Z',
        meeting_link: 'https://meet.google.com/abc-defg-hij',
      });

      // Pending student sees empty schedule
      const pendingRes = await student.get('/me/schedule');
      expect(pendingRes.status).toBe(200);
      expect(pendingRes.body.schedule).toHaveLength(0);

      // Approve student
      const rosterRes = await prof.get(`/classes/${cls.id}/enrollments`);
      const studentEnr = rosterRes.body.enrollments.find((e: { user_id: string }) => e.user_id === student.user.id);
      await prof.patch(`/classes/${cls.id}/enrollments/${studentEnr.id}`, { status: 'approved' });

      // Approved student sees session
      const approvedRes = await student.get('/me/schedule');
      expect(approvedRes.status).toBe(200);
      expect(approvedRes.body.schedule).toHaveLength(1);
      expect(approvedRes.body.schedule[0].meeting_id).toBe('abc-defg-hij');
      expect(approvedRes.body.schedule[0].class_name).toBe('Math 101');
    });
  });

  describe('Events Ingestion (POST /events)', () => {
    let clsId: string;
    let sessionId: string;

    beforeEach(async () => {
      const cls = await createClass(prof);
      clsId = cls.id;
      await join(student, cls.class_code!);

      // Approve student
      const rosterRes = await prof.get(`/classes/${cls.id}/enrollments`);
      const studentEnr = rosterRes.body.enrollments.find((e: { user_id: string }) => e.user_id === student.user.id);
      await prof.patch(`/classes/${cls.id}/enrollments/${studentEnr.id}`, { status: 'approved' });

      // Create session
      const sRes = await prof.post(`/classes/${cls.id}/sessions`, {
        starts_at: '2026-10-25T14:00:00.000Z',
        ends_at: '2026-10-25T15:00:00.000Z',
        meeting_link: 'https://meet.google.com/abc-defg-hij',
      });
      sessionId = sRes.body.session.id;
    });

    it('accepts valid events within session window and dedupes', async () => {
      const batch = {
        events: [
          {
            user_id: student.user.id,
            class_id: clsId,
            session_id: sessionId,
            type: 'presence',
            state: 'active',
            timestamp: '2026-10-25T14:05:00.000Z',
            source: 'extension',
          },
          {
            user_id: student.user.id,
            class_id: clsId,
            session_id: sessionId,
            type: 'meeting_joined',
            state: null,
            timestamp: '2026-10-25T14:06:00.000Z',
            source: 'extension',
          },
        ],
      };

      const res1 = await student.post('/events', batch);
      expect(res1.status).toBe(201);
      expect(res1.body.received).toBe(2);
      expect(res1.body.inserted).toBe(2);

      // Re-sending identical batch dedupes (inserted = 0)
      const res2 = await student.post('/events', batch);
      expect(res2.status).toBe(201);
      expect(res2.body.received).toBe(2);
      expect(res2.body.inserted).toBe(0);
    });

    it('rejects events outside any active session window (out_of_session)', async () => {
      const outsideEvent = {
        events: [
          {
            user_id: student.user.id,
            class_id: clsId,
            session_id: null,
            type: 'presence',
            state: 'active',
            timestamp: '2026-10-25T13:45:00.000Z', // 15 min before session
            source: 'extension',
          },
        ],
      };

      const res = await student.post('/events', outsideEvent);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('out_of_session');
    });

    it('rejects events if student has no recorded consent', async () => {
      // Clear consent for student
      await pool.query('UPDATE users SET consent_at = NULL WHERE id = $1', [student.user.id]);

      const res = await student.post('/events', {
        events: [
          {
            user_id: student.user.id,
            class_id: clsId,
            session_id: null,
            type: 'presence',
            state: 'active',
            timestamp: '2026-10-25T14:05:00.000Z',
            source: 'extension',
          },
        ],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('consent_required');
    });

    it('rejects events if student is not approved in that class', async () => {
      const student2 = await signUp(app, 'Pending Student');
      const cls2 = await createClass(prof);
      await join(student2, cls2.class_code!); // joins but pending

      await prof.post(`/classes/${cls2.id}/sessions`, {
        starts_at: '2026-10-25T14:00:00.000Z',
        ends_at: '2026-10-25T15:00:00.000Z',
        meeting_link: 'https://meet.google.com/abc-defg-hij',
      });

      const res = await student2.post('/events', {
        events: [
          {
            user_id: student2.user.id,
            class_id: cls2.id,
            session_id: null,
            type: 'presence',
            state: 'active',
            timestamp: '2026-10-25T14:05:00.000Z',
            source: 'extension',
          },
        ],
      });
      expect(res.status).toBe(403);
    });

    it('rejects events if submitted on behalf of another user', async () => {
      const res = await student.post('/events', {
        events: [
          {
            user_id: prof.user.id, // trying to submit for prof
            class_id: clsId,
            session_id: null,
            type: 'presence',
            state: 'active',
            timestamp: '2026-10-25T14:05:00.000Z',
            source: 'extension',
          },
        ],
      });
      expect(res.status).toBe(403);
    });
  });

  describe('Live Class Status & Cross-Class Access Control', () => {
    it('computes live status for approved students and returns to professor', async () => {
      const cls = await createClass(prof);
      await join(student, cls.class_code!);

      const rosterRes = await prof.get(`/classes/${cls.id}/enrollments`);
      const studentEnr = rosterRes.body.enrollments.find((e: { user_id: string }) => e.user_id === student.user.id);
      await prof.patch(`/classes/${cls.id}/enrollments/${studentEnr.id}`, { status: 'approved' });

      // Before session: status should be not_in_session
      const statusRes1 = await prof.get(`/classes/${cls.id}/status`);
      expect(statusRes1.status).toBe(200);
      expect(statusRes1.body.status).toHaveLength(1);
      expect(statusRes1.body.status[0].status).toBe('not_in_session');

      // Create session active right now
      const now = new Date();
      const startsAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
      const endsAt = new Date(now.getTime() + 50 * 60 * 1000).toISOString();

      await prof.post(`/classes/${cls.id}/sessions`, {
        starts_at: startsAt,
        ends_at: endsAt,
        meeting_link: 'https://meet.google.com/abc-defg-hij',
      });

      // Submit active presence 1 min ago
      await student.post('/events', {
        events: [
          {
            user_id: student.user.id,
            class_id: cls.id,
            session_id: null,
            type: 'presence',
            state: 'active',
            timestamp: new Date(now.getTime() - 60 * 1000).toISOString(),
            source: 'extension',
          },
        ],
      });

      // Status should now be online
      const statusRes2 = await prof.get(`/classes/${cls.id}/status`);
      expect(statusRes2.status).toBe(200);
      expect(statusRes2.body.status[0].status).toBe('online');
      expect(statusRes2.body.status[0].source).toBe('extension');
    });

    it('cross-class access denied: prof A cannot see or create sessions for class B', async () => {
      const profB = await signUp(app, 'Prof B');
      const clsB = await createClass(profB);

      // prof A tries to read sessions of class B -> 404
      const res1 = await prof.get(`/classes/${clsB.id}/sessions`);
      expect(res1.status).toBe(404);

      // prof A tries to create session in class B -> 404
      const res2 = await prof.post(`/classes/${clsB.id}/sessions`, {
        starts_at: '2026-10-25T14:00:00.000Z',
        ends_at: '2026-10-25T15:00:00.000Z',
        meeting_link: 'https://meet.google.com/abc-defg-hij',
      });
      expect(res2.status).toBe(404);

      // prof A tries to read status of class B -> 404
      const res3 = await prof.get(`/classes/${clsB.id}/status`);
      expect(res3.status).toBe(404);
    });
  });
});
