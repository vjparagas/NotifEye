import type { PoolClient } from 'pg';
import {
  calculateAttendanceStatus,
  type AttendanceAuditDTO,
  type AttendanceRecordDTO,
  type NormalizedEvent,
  type OverrideAttendanceInput,
  type SessionDTO,
} from '@notifeye/shared';
import { pool } from '../../db';
import { HttpError } from '../../shared/errors';
import { requireProfessor } from '../../shared/access-control';
import { recordAlert } from '../alerts/service';

export async function evaluateSessionAttendance(
  sessionId: string,
  clientOrPool: PoolClient | typeof pool = pool,
  now: Date = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();

  // 1. Fetch session info
  const { rows: sessionRows } = await clientOrPool.query<{
    id: string;
    class_id: string;
    starts_at: Date;
    ends_at: Date;
    grace_minutes: number;
    finalized_at: Date | null;
  }>(
    `SELECT id, class_id, starts_at, ends_at, grace_minutes, finalized_at
       FROM class_sessions
      WHERE id = $1`,
    [sessionId],
  );

  const session = sessionRows[0];
  if (!session) return;

  const startMs = session.starts_at.getTime();
  const graceBoundaryMs = startMs + session.grace_minutes * 60 * 1000;
  const nowMs = now.getTime();
  const endMs = session.ends_at.getTime();

  // 2. If grace period has elapsed, ensure all approved students who haven't joined are marked Absent
  if (nowMs >= graceBoundaryMs) {
    await clientOrPool.query(
      `INSERT INTO attendance_records (session_id, user_id, status, source)
       SELECT $1, e.user_id, 'absent', 'extension'
         FROM enrollments e
        WHERE e.class_id = $2
          AND e.role = 'student'
          AND e.status = 'approved'
          AND NOT EXISTS (
            SELECT 1 FROM attendance_records ar
             WHERE ar.session_id = $1 AND ar.user_id = e.user_id
          )
       ON CONFLICT (session_id, user_id) DO NOTHING`,
      [sessionId, session.class_id],
    );

    // Create an ABSENT alert for the professor of that class (once per session/student)
    const { rows: absentStudents } = await clientOrPool.query<{
      user_id: string;
      student_name: string;
      class_name: string;
    }>(
      `SELECT e.user_id, u.name AS student_name, c.name AS class_name
         FROM enrollments e
         JOIN users u ON u.id = e.user_id
         JOIN classes c ON c.id = e.class_id
         JOIN attendance_records ar ON ar.session_id = $1 AND ar.user_id = e.user_id
        WHERE e.class_id = $2
          AND e.role = 'student'
          AND e.status = 'approved'
          AND ar.status = 'absent'
          AND ar.joined_at IS NULL`,
      [sessionId, session.class_id],
    );

    for (const student of absentStudents) {
      await recordAlert({
        classId: session.class_id,
        sessionId: session.id,
        userId: student.user_id,
        kind: 'absent',
        message: `${student.student_name} has not joined "${student.class_name}" and the ${session.grace_minutes}-minute grace period has ended.`,
        clientOrPool,
      });
    }
  }

  // 3. If session ended, finalize session
  if (nowMs >= endMs && !session.finalized_at) {
    await clientOrPool.query(
      `UPDATE class_sessions
          SET finalized_at = $1
        WHERE id = $2 AND finalized_at IS NULL`,
      [nowIso, sessionId],
    );
  }
}

export async function processEventForAttendance(
  client: PoolClient,
  event: NormalizedEvent,
  session: { starts_at: Date; ends_at: Date; grace_minutes: number },
): Promise<void> {
  if (event.type !== 'meeting_joined' && event.type !== 'meeting_left') {
    return;
  }

  const sessionConfig = {
    starts_at: session.starts_at.toISOString(),
    ends_at: session.ends_at.toISOString(),
    grace_minutes: session.grace_minutes,
  };

  // Lock existing attendance record row if present
  const { rows: existingRows } = await client.query<{
    id: string;
    joined_at: Date | null;
    left_at: Date | null;
    status: 'present' | 'late' | 'absent';
    overridden_by: string | null;
  }>(
    `SELECT id, joined_at, left_at, status, overridden_by
       FROM attendance_records
      WHERE session_id = $1 AND user_id = $2
      FOR UPDATE`,
    [event.session_id, event.user_id],
  );

  const existing = existingRows[0];

  if (event.type === 'meeting_joined') {
    const startMs = session.starts_at.getTime();
    const graceBoundaryMs = startMs + session.grace_minutes * 60 * 1000;
    const eventTimeMs = new Date(event.timestamp).getTime();

    if (!existing) {
      // First time recording attendance for this user in this session
      const calc = calculateAttendanceStatus(sessionConfig, event.timestamp, null, false);
      const initialStatus = calc.status ?? 'present';

      await client.query(
        `INSERT INTO attendance_records (session_id, user_id, joined_at, status, source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())`,
        [event.session_id, event.user_id, event.timestamp, initialStatus, event.source],
      );

      if (initialStatus === 'late' || eventTimeMs > graceBoundaryMs) {
        const minutesLate = Math.max(1, Math.round((eventTimeMs - startMs) / 60000));
        await recordAlert({
          classId: event.class_id,
          sessionId: event.session_id!,
          userId: event.user_id,
          kind: 'late',
          message: `Student joined late (${minutesLate} min after session start).`,
          clientOrPool: client,
        });
      }
      return;
    }

    // Record already exists:
    if (existing.overridden_by) {
      // Overridden by professor: never auto-revert or change status
      await client.query(
        `UPDATE attendance_records
            SET joined_at = LEAST(COALESCE(joined_at, $1), $1),
                updated_at = now()
          WHERE id = $2`,
        [event.timestamp, existing.id],
      );
      return;
    }

    // Not overridden:
    const calc = calculateAttendanceStatus(sessionConfig, event.timestamp, existing.status, false);

    if (calc.isLateFlipFromAbsent) {
      // Student joins after Absent mark -> flips to Late (audited)
      await client.query(
        `UPDATE attendance_records
            SET status = 'late',
                joined_at = LEAST(COALESCE(joined_at, $1), $1),
                updated_at = now()
          WHERE id = $2`,
        [event.timestamp, existing.id],
      );

      // Audit entry: actor_id NULL = system
      await client.query(
        `INSERT INTO attendance_audit (attendance_id, actor_id, old_status, new_status, reason, created_at)
         VALUES ($1, NULL, 'absent', 'late', 'Late join after absent mark', now())`,
        [existing.id],
      );

      const minutesLate = Math.max(1, Math.round((eventTimeMs - startMs) / 60000));
      await recordAlert({
        classId: event.class_id,
        sessionId: event.session_id!,
        userId: event.user_id,
        kind: 'late',
        message: `Student joined late (${minutesLate} min after session start).`,
        clientOrPool: client,
      });
    } else {
      await client.query(
        `UPDATE attendance_records
            SET joined_at = LEAST(COALESCE(joined_at, $1), $1),
                updated_at = now()
          WHERE id = $2`,
        [event.timestamp, existing.id],
      );

      if (existing.status !== 'present' && (calc.status === 'late' || eventTimeMs > graceBoundaryMs)) {
        const minutesLate = Math.max(1, Math.round((eventTimeMs - startMs) / 60000));
        await recordAlert({
          classId: event.class_id,
          sessionId: event.session_id!,
          userId: event.user_id,
          kind: 'late',
          message: `Student joined late (${minutesLate} min after session start).`,
          clientOrPool: client,
        });
      }
    }
  } else if (event.type === 'meeting_left') {
    if (existing) {
      await client.query(
        `UPDATE attendance_records
            SET left_at = GREATEST(COALESCE(left_at, $1), $1),
                updated_at = now()
          WHERE id = $2`,
        [event.timestamp, existing.id],
      );
    } else {
      // Left without a previous joined event recorded
      const calc = calculateAttendanceStatus(sessionConfig, event.timestamp, null, false);
      const initialStatus = calc.status ?? 'present';
      await client.query(
        `INSERT INTO attendance_records (session_id, user_id, left_at, status, source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())`,
        [event.session_id, event.user_id, event.timestamp, initialStatus, event.source],
      );
    }
  }
}

export async function getSessionAttendance(
  userId: string,
  sessionId: string,
): Promise<{ session: SessionDTO; attendance: AttendanceRecordDTO[] }> {
  // 1. Fetch session
  const { rows: sessionRows } = await pool.query<SessionDTO>(
    `SELECT id, class_id, starts_at, ends_at, meeting_link, meeting_id, grace_minutes,
            summary_sent_at, finalized_at, created_at
       FROM class_sessions
      WHERE id = $1`,
    [sessionId],
  );

  const session = sessionRows[0];
  if (!session) {
    throw new HttpError(404, 'not_found', 'Session not found');
  }

  // 2. Ensure user is professor of that class
  await requireProfessor(userId, session.class_id);

  // 3. Fetch attendance records with student names and emails

  // 4. Fetch attendance records with student names and emails
  const { rows: attendance } = await pool.query<AttendanceRecordDTO>(
    `SELECT ar.id, ar.session_id, ar.user_id, u.name AS student_name, u.email AS student_email,
            ar.joined_at, ar.left_at, ar.status, ar.source, ar.overridden_by, ar.overridden_at,
            ar.conflict, ar.created_at, ar.updated_at
       FROM attendance_records ar
       JOIN users u ON u.id = ar.user_id
      WHERE ar.session_id = $1
      ORDER BY u.name ASC`,
    [sessionId],
  );

  return { session, attendance };
}

export async function overrideAttendance(
  userId: string,
  attendanceId: string,
  input: OverrideAttendanceInput,
): Promise<AttendanceRecordDTO> {
  // 1. Fetch record & class_id
  const { rows: recordRows } = await pool.query<{
    id: string;
    session_id: string;
    class_id: string;
    status: string;
  }>(
    `SELECT ar.id, ar.session_id, cs.class_id, ar.status
       FROM attendance_records ar
       JOIN class_sessions cs ON cs.id = ar.session_id
      WHERE ar.id = $1`,
    [attendanceId],
  );

  const existing = recordRows[0];
  if (!existing) {
    throw new HttpError(404, 'not_found', 'Attendance record not found');
  }

  // 2. Must be professor of that class
  await requireProfessor(userId, existing.class_id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 3. Update attendance record
    await client.query(
      `UPDATE attendance_records
          SET status = $1,
              overridden_by = $2,
              overridden_at = now(),
              source = 'manual',
              updated_at = now()
        WHERE id = $3`,
      [input.status, userId, attendanceId],
    );

    // 4. Insert audit log
    await client.query(
      `INSERT INTO attendance_audit (attendance_id, actor_id, old_status, new_status, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [attendanceId, userId, existing.status, input.status, input.reason || 'Professor override'],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 5. Return updated record with student details
  const { rows } = await pool.query<AttendanceRecordDTO>(
    `SELECT ar.id, ar.session_id, ar.user_id, u.name AS student_name, u.email AS student_email,
            ar.joined_at, ar.left_at, ar.status, ar.source, ar.overridden_by, ar.overridden_at,
            ar.conflict, ar.created_at, ar.updated_at
       FROM attendance_records ar
       JOIN users u ON u.id = ar.user_id
      WHERE ar.id = $1`,
    [attendanceId],
  );

  return rows[0]!;
}

export async function getAttendanceAudit(
  userId: string,
  attendanceId: string,
): Promise<AttendanceAuditDTO[]> {
  const { rows: recordRows } = await pool.query<{ class_id: string }>(
    `SELECT cs.class_id
       FROM attendance_records ar
       JOIN class_sessions cs ON cs.id = ar.session_id
      WHERE ar.id = $1`,
    [attendanceId],
  );

  const record = recordRows[0];
  if (!record) {
    throw new HttpError(404, 'not_found', 'Attendance record not found');
  }

  await requireProfessor(userId, record.class_id);

  const { rows } = await pool.query<AttendanceAuditDTO>(
    `SELECT a.id, a.attendance_id, a.actor_id, u.name AS actor_name,
            a.old_status, a.new_status, a.reason, a.created_at
       FROM attendance_audit a
  LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.attendance_id = $1
      ORDER BY a.created_at ASC`,
    [attendanceId],
  );

  return rows;
}
