import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import {
  calculateAttendanceStatus,
  type SessionWindowWithGrace,
} from '@notifeye/shared';
import {
  createClass,
  join,
  makeApp,
  resetDb,
  signUp,
  type Client,
} from './helpers';
import { pool } from '../src/db';

describe('Phase 4A Attendance Calculation & Endpoints', () => {
  describe('Unit: Grace Boundary ±1 second & Absent->Late Flip (injected clock)', () => {
    const session: SessionWindowWithGrace = {
      starts_at: '2026-10-25T10:00:00.000Z',
      ends_at: '2026-10-25T11:00:00.000Z',
      grace_minutes: 10, // Grace boundary is 10:10:00.000Z
    };

    it('1. Present when first join is 1 second before grace boundary (10:09:59)', () => {
      const joinTime = '2026-10-25T10:09:59.000Z';
      const res = calculateAttendanceStatus(session, joinTime, null, false);
      expect(res.status).toBe('present');
      expect(res.isLateFlipFromAbsent).toBe(false);
    });

    it('2. Present when first join is exactly on the grace boundary (10:10:00)', () => {
      const joinTime = '2026-10-25T10:10:00.000Z';
      const res = calculateAttendanceStatus(session, joinTime, null, false);
      expect(res.status).toBe('present');
      expect(res.isLateFlipFromAbsent).toBe(false);
    });

    it('3. Late when first join is 1 second after grace boundary (10:10:01)', () => {
      const joinTime = '2026-10-25T10:10:01.000Z';
      const res = calculateAttendanceStatus(session, joinTime, null, false);
      expect(res.status).toBe('late');
      expect(res.isLateFlipFromAbsent).toBe(false);
    });

    it('4. Not absent yet when no join and current time is 1 second before grace boundary (10:09:59)', () => {
      const now = new Date('2026-10-25T10:09:59.000Z');
      const res = calculateAttendanceStatus(session, null, null, false, now);
      expect(res.status).toBeNull();
    });

    it('5. Absent once grace period ends with no join at boundary (10:10:00)', () => {
      const now = new Date('2026-10-25T10:10:00.000Z');
      const res = calculateAttendanceStatus(session, null, null, false, now);
      expect(res.status).toBe('absent');
      expect(res.isLateFlipFromAbsent).toBe(false);
    });

    it('6. Absent once grace period ends with no join 1 second after boundary (10:10:01)', () => {
      const now = new Date('2026-10-25T10:10:01.000Z');
      const res = calculateAttendanceStatus(session, null, null, false, now);
      expect(res.status).toBe('absent');
      expect(res.isLateFlipFromAbsent).toBe(false);
    });

    it('7. Absent flips to Late when student joins afterward (10:15:00)', () => {
      const joinTime = '2026-10-25T10:15:00.000Z';
      const res = calculateAttendanceStatus(session, joinTime, 'absent', false);
      expect(res.status).toBe('late');
      expect(res.isLateFlipFromAbsent).toBe(true);
    });

    it('8. Overridden status is never auto-reverted by later events', () => {
      const joinTime = '2026-10-25T10:20:00.000Z';
      // Professor previously overrode to 'present'
      const res = calculateAttendanceStatus(session, joinTime, 'present', true);
      expect(res.status).toBe('present');
      expect(res.isLateFlipFromAbsent).toBe(false);
    });
  });

  describe('Integration: Meeting events, Absent->Late flip, overrides, and access control', () => {
    let app: Express;
    let profA: Client;
    let profB: Client;
    let student1: Client;
    let student2: Client;

    async function approve(prof: Client, classId: string, studentId: string) {
      const rosterRes = await prof.get(`/classes/${classId}/enrollments`);
      const enr = rosterRes.body.enrollments.find((e: { user_id: string }) => e.user_id === studentId);
      await prof.patch(`/classes/${classId}/enrollments/${enr.id}`, { status: 'approved' });
    }

    beforeEach(async () => {
      app = makeApp();
      await resetDb();
      profA = await signUp(app, 'Prof Alpha');
      profB = await signUp(app, 'Prof Beta');
      student1 = await signUp(app, 'Student S1');
      student2 = await signUp(app, 'Student S2');
    });

    it('meeting_joined inside grace marks student Present, meeting_left records left_at', async () => {
      const cls = await createClass(profA);
      await join(student1, cls.class_code!);
      await approve(profA, cls.id, student1.user.id);

      const startsAt = '2026-10-25T14:00:00.000Z';
      const endsAt = '2026-10-25T15:00:00.000Z';
      const sessRes = await profA.post(`/classes/${cls.id}/sessions`, {
        starts_at: startsAt,
        ends_at: endsAt,
        meeting_link: 'https://meet.google.com/abc-defg-hij',
        grace_minutes: 10,
      });
      const sessionId = sessRes.body.session.id;

      // Student joins 5 minutes in (<= grace 10 min) -> Present
      const joinTime = '2026-10-25T14:05:00.000Z';
      await student1.post('/events', {
        events: [
          {
            user_id: student1.user.id,
            class_id: cls.id,
            session_id: sessionId,
            type: 'meeting_joined',
            state: null,
            timestamp: joinTime,
            source: 'extension',
          },
        ],
      });

      // Student leaves at 14:45
      const leaveTime = '2026-10-25T14:45:00.000Z';
      await student1.post('/events', {
        events: [
          {
            user_id: student1.user.id,
            class_id: cls.id,
            session_id: sessionId,
            type: 'meeting_left',
            state: null,
            timestamp: leaveTime,
            source: 'extension',
          },
        ],
      });

      const attRes = await profA.get(`/sessions/${sessionId}/attendance`);
      expect(attRes.status).toBe(200);
      expect(attRes.body.attendance).toHaveLength(1);
      const rec = attRes.body.attendance[0];
      expect(rec.user_id).toBe(student1.user.id);
      expect(rec.status).toBe('present');
      expect(new Date(rec.joined_at).toISOString()).toBe(joinTime);
      expect(new Date(rec.left_at).toISOString()).toBe(leaveTime);
    });

    it('Absent once grace period ends with no join, flipping to Late if student joins afterward (audited)', async () => {
      const cls = await createClass(profA);
      await join(student1, cls.class_code!);
      await approve(profA, cls.id, student1.user.id);

      const startsAt = '2026-10-25T14:00:00.000Z';
      const endsAt = '2026-10-25T15:00:00.000Z';
      const sessRes = await profA.post(`/classes/${cls.id}/sessions`, {
        starts_at: startsAt,
        ends_at: endsAt,
        meeting_link: 'https://meet.google.com/abc-defg-hij',
        grace_minutes: 10, // Grace ends at 14:10
      });
      const sessionId = sessRes.body.session.id;

      // Simulate time past grace (14:12) via attendance evaluation
      const { evaluateSessionAttendance } = await import('../src/modules/attendance/service');
      await evaluateSessionAttendance(sessionId, pool, new Date('2026-10-25T14:12:00.000Z'));

      // Check student is marked Absent
      let attRes = await profA.get(`/sessions/${sessionId}/attendance`);
      expect(attRes.status).toBe(200);
      expect(attRes.body.attendance).toHaveLength(1);
      expect(attRes.body.attendance[0].status).toBe('absent');
      const attendanceId = attRes.body.attendance[0].id;

      // Now student joins late at 14:15
      const lateJoinTime = '2026-10-25T14:15:00.000Z';
      const eventRes = await student1.post('/events', {
        events: [
          {
            user_id: student1.user.id,
            class_id: cls.id,
            session_id: sessionId,
            type: 'meeting_joined',
            state: null,
            timestamp: lateJoinTime,
            source: 'extension',
          },
        ],
      });
      expect(eventRes.status).toBe(201);

      // Verify status flipped from absent to late
      attRes = await profA.get(`/sessions/${sessionId}/attendance`);
      expect(attRes.body.attendance[0].status).toBe('late');
      expect(new Date(attRes.body.attendance[0].joined_at).toISOString()).toBe(lateJoinTime);

      // Verify audit entry created with actor_id = null (system flip)
      const auditRes = await profA.get(`/attendance/${attendanceId}/audit`);
      expect(auditRes.status).toBe(200);
      expect(auditRes.body.audit).toHaveLength(1);
      const audit = auditRes.body.audit[0];
      expect(audit.actor_id).toBeNull();
      expect(audit.old_status).toBe('absent');
      expect(audit.new_status).toBe('late');
      expect(audit.reason).toContain('Late join');
    });

    it('professor override PATCH /attendance/:id is audited in attendance_audit and not overwritten by subsequent events', async () => {
      const cls = await createClass(profA);
      await join(student1, cls.class_code!);
      await approve(profA, cls.id, student1.user.id);

      const startsAt = '2026-10-25T14:00:00.000Z';
      const endsAt = '2026-10-25T15:00:00.000Z';
      const sessRes = await profA.post(`/classes/${cls.id}/sessions`, {
        starts_at: startsAt,
        ends_at: endsAt,
        meeting_link: 'https://meet.google.com/abc-defg-hij',
        grace_minutes: 5,
      });
      const sessionId = sessRes.body.session.id;

      // Student joins late at 14:10 (> grace 5 min)
      await student1.post('/events', {
        events: [
          {
            user_id: student1.user.id,
            class_id: cls.id,
            session_id: sessionId,
            type: 'meeting_joined',
            state: null,
            timestamp: '2026-10-25T14:10:00.000Z',
            source: 'extension',
          },
        ],
      });

      const initialAtt = await profA.get(`/sessions/${sessionId}/attendance`);
      expect(initialAtt.body.attendance[0].status).toBe('late');
      const attendanceId = initialAtt.body.attendance[0].id;

      // Professor overrides status from 'late' to 'present' with reason 'Doctor appointment'
      const overrideRes = await profA.patch(`/attendance/${attendanceId}`, {
        status: 'present',
        reason: 'Excused - doctor appointment',
      });
      expect(overrideRes.status).toBe(200);
      expect(overrideRes.body.attendance.status).toBe('present');
      expect(overrideRes.body.attendance.overridden_by).toBe(profA.user.id);
      expect(overrideRes.body.attendance.source).toBe('manual');

      // Verify audit record was written with professor actor_id
      const auditRes = await profA.get(`/attendance/${attendanceId}/audit`);
      expect(auditRes.status).toBe(200);
      expect(auditRes.body.audit).toHaveLength(1);
      expect(auditRes.body.audit[0].actor_id).toBe(profA.user.id);
      expect(auditRes.body.audit[0].old_status).toBe('late');
      expect(auditRes.body.audit[0].new_status).toBe('present');
      expect(auditRes.body.audit[0].reason).toBe('Excused - doctor appointment');

      // Subsequent event: student leaves and rejoins late again
      await student1.post('/events', {
        events: [
          {
            user_id: student1.user.id,
            class_id: cls.id,
            session_id: sessionId,
            type: 'meeting_joined',
            state: null,
            timestamp: '2026-10-25T14:25:00.000Z',
            source: 'extension',
          },
        ],
      });

      // Verify status REMAINS 'present' (not reverted)
      const finalAtt = await profA.get(`/sessions/${sessionId}/attendance`);
      expect(finalAtt.body.attendance[0].status).toBe('present');
      expect(finalAtt.body.attendance[0].overridden_by).toBe(profA.user.id);
    });

    it('cross-class access denied for /sessions/:id/attendance and /attendance/:id', async () => {
      const clsA = await createClass(profA, { name: 'Class A' });
      const clsB = await createClass(profB, { name: 'Class B' });

      await join(student1, clsA.class_code!);
      await approve(profA, clsA.id, student1.user.id);

      // Create session in class A
      const sessRes = await profA.post(`/classes/${clsA.id}/sessions`, {
        starts_at: '2026-10-25T14:00:00.000Z',
        ends_at: '2026-10-25T15:00:00.000Z',
        meeting_link: 'https://meet.google.com/abc-defg-hij',
        grace_minutes: 10,
      });
      const sessionIdA = sessRes.body.session.id;

      // Student joins to generate attendance record
      await student1.post('/events', {
        events: [
          {
            user_id: student1.user.id,
            class_id: clsA.id,
            session_id: sessionIdA,
            type: 'meeting_joined',
            state: null,
            timestamp: '2026-10-25T14:05:00.000Z',
            source: 'extension',
          },
        ],
      });

      const attRes = await profA.get(`/sessions/${sessionIdA}/attendance`);
      const attendanceIdA = attRes.body.attendance[0].id;

      // 1. Professor B cannot view class A session attendance (404)
      const profBAccess = await profB.get(`/sessions/${sessionIdA}/attendance`);
      expect(profBAccess.status).toBe(404);

      // 2. Professor B cannot override class A attendance (404)
      const profBOverride = await profB.patch(`/attendance/${attendanceIdA}`, {
        status: 'absent',
      });
      expect(profBOverride.status).toBe(404);

      // 3. Student 1 cannot view attendance endpoint (403 forbidden)
      const studentView = await student1.get(`/sessions/${sessionIdA}/attendance`);
      expect(studentView.status).toBe(403);

      // 4. Student 1 cannot override attendance (403 forbidden)
      const studentOverride = await student1.patch(`/attendance/${attendanceIdA}`, {
        status: 'present',
      });
      expect(studentOverride.status).toBe(403);

      // 5. Unauthenticated requests are rejected (401)
      const anon = makeApp();
      const unauth1 = await (await import('supertest')).default(anon).get(`/sessions/${sessionIdA}/attendance`);
      expect(unauth1.status).toBe(401);

      const unauth2 = await (await import('supertest')).default(anon).patch(`/attendance/${attendanceIdA}`).send({ status: 'present' });
      expect(unauth2.status).toBe(401);
    });
  });
});
