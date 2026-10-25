import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createClass, join, makeApp, resetDb, signUp, type Client } from './helpers';
import { runAttendanceSweep } from '../src/modules/scheduler';
import { pool } from '../src/db';

describe('Scheduler Attendance Sweep Cron Job', () => {
  let app: Express;
  let prof: Client;
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
    prof = await signUp(app, 'Prof Cron');
    student1 = await signUp(app, 'Student S1');
    student2 = await signUp(app, 'Student S2');
  });

  it('marks Absent at grace end for approved students with no join, and finalizes at ends_at', async () => {
    const cls = await createClass(prof);
    await join(student1, cls.class_code!);
    await join(student2, cls.class_code!);
    await approve(prof, cls.id, student1.user.id);
    await approve(prof, cls.id, student2.user.id);

    const startsAt = '2026-10-25T14:00:00.000Z';
    const endsAt = '2026-10-25T15:00:00.000Z';
    const sessRes = await prof.post(`/classes/${cls.id}/sessions`, {
      starts_at: startsAt,
      ends_at: endsAt,
      meeting_link: 'https://meet.google.com/abc-defg-hij',
      grace_minutes: 10, // Grace ends at 14:10
    });
    const sessionId = sessRes.body.session.id;

    // Student 1 joins at 14:05 (<= grace) -> Present
    await student1.post('/events', {
      events: [
        {
          user_id: student1.user.id,
          class_id: cls.id,
          session_id: sessionId,
          type: 'meeting_joined',
          state: null,
          timestamp: '2026-10-25T14:05:00.000Z',
          source: 'extension',
        },
      ],
    });

    // 1. Sweep before grace end (14:08): Student 2 is NOT marked absent yet
    await runAttendanceSweep(new Date('2026-10-25T14:08:00.000Z'));
    const beforeGraceAtt = await prof.get(`/sessions/${sessionId}/attendance`);
    expect(beforeGraceAtt.body.attendance).toHaveLength(1);
    expect(beforeGraceAtt.body.attendance[0].user_id).toBe(student1.user.id);

    // 2. Sweep after grace end (14:11): Student 2 IS marked Absent
    await runAttendanceSweep(new Date('2026-10-25T14:11:00.000Z'));
    const afterGraceAtt = await prof.get(`/sessions/${sessionId}/attendance`);
    expect(afterGraceAtt.body.attendance).toHaveLength(2);
    const s2Rec = afterGraceAtt.body.attendance.find((a: any) => a.user_id === student2.user.id);
    expect(s2Rec).toBeDefined();
    expect(s2Rec.status).toBe('absent');

    // 3. Sweep at ends_at (15:01): Session is finalized
    await runAttendanceSweep(new Date('2026-10-25T15:01:00.000Z'));
    const { rows } = await pool.query<{ finalized_at: Date | null }>(
      'SELECT finalized_at FROM class_sessions WHERE id = $1',
      [sessionId],
    );
    expect(rows[0]?.finalized_at).not.toBeNull();
  });
});
