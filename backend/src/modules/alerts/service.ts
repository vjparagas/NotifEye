import type { PoolClient } from 'pg';
import type { AlertDTO } from '@notifeye/shared';
import { pool } from '../../db';
import { HttpError } from '../../shared/errors';
import { requireProfessor } from '../../shared/access-control';
import { sendAlertEmail } from './mailer';

interface AlertRow {
  id: string;
  class_id: string;
  session_id: string | null;
  user_id: string | null;
  kind: string;
  message: string;
  channels_sent: string[];
  created_at: Date;
  read_at: Date | null;
  student_name?: string | null;
  student_email?: string | null;
  class_name?: string | null;
}

function mapAlertRow(r: AlertRow): AlertDTO {
  return {
    id: r.id,
    class_id: r.class_id,
    session_id: r.session_id,
    user_id: r.user_id,
    kind: r.kind,
    message: r.message,
    channels_sent: r.channels_sent,
    created_at: r.created_at.toISOString(),
    read_at: r.read_at ? r.read_at.toISOString() : null,
    student_name: r.student_name ?? null,
    student_email: r.student_email ?? null,
    class_name: r.class_name ?? null,
  };
}

export interface RecordAlertInput {
  classId: string;
  sessionId: string;
  userId: string;
  kind: 'absent' | 'late';
  message: string;
  clientOrPool?: PoolClient | typeof pool;
}

/**
 * Inserts an alert using the UNIQUE index (session_id, user_id, kind).
 * Idempotent: If it already exists, ON CONFLICT DO NOTHING ensures it never duplicates.
 * When newly created, it dispatches an email via Mailpit to the class's professor(s).
 */
export async function recordAlert(input: RecordAlertInput): Promise<AlertDTO | null> {
  const clientOrPool = input.clientOrPool ?? pool;

  // 1. Insert alert if not already created
  const { rows } = await clientOrPool.query<AlertRow>(
    `INSERT INTO alerts (class_id, session_id, user_id, kind, message, channels_sent, created_at)
     VALUES ($1, $2, $3, $4, $5, ARRAY['dashboard', 'email']::text[], now())
     ON CONFLICT (session_id, user_id, kind) WHERE session_id IS NOT NULL DO NOTHING
     RETURNING id, class_id, session_id, user_id, kind, message, channels_sent, created_at, read_at`,
    [input.classId, input.sessionId, input.userId, input.kind, input.message],
  );

  const newAlert = rows[0];
  if (!newAlert) {
    // Already existed: idempotent no-op
    return null;
  }

  // 2. Fetch class and student info for email notification
  const { rows: metaRows } = await clientOrPool.query<{
    class_name: string;
    student_name: string | null;
    student_email: string | null;
  }>(
    `SELECT c.name AS class_name, u.name AS student_name, u.email AS student_email
       FROM classes c
       LEFT JOIN users u ON u.id = $2
      WHERE c.id = $1`,
    [input.classId, input.userId],
  );

  const meta = metaRows[0];
  const className = meta?.class_name ?? 'Class';
  const studentName = meta?.student_name ?? 'A student';

  // 3. Find approved professor(s) of this class to send email to
  const { rows: profRows } = await clientOrPool.query<{ id: string; email: string; name: string }>(
    `SELECT u.id, u.email, u.name
       FROM users u
       JOIN enrollments e ON e.user_id = u.id
      WHERE e.class_id = $1
        AND e.role = 'professor'
        AND e.status = 'approved'`,
    [input.classId],
  );

  for (const prof of profRows) {
    await sendAlertEmail({
      to: prof.email,
      professorName: prof.name,
      studentName,
      className,
      kind: input.kind,
      message: input.message,
    });
  }

  return mapAlertRow({
    ...newAlert,
    class_name: className,
    student_name: studentName,
    student_email: meta?.student_email ?? null,
  });
}

/**
 * Returns alerts visible to the professor.
 * If classId is specified, verifies the user is an approved professor of that class.
 * If classId is omitted, returns alerts for all classes where user is an approved professor.
 */
export async function getAlertsForProfessor(userId: string, classId?: string): Promise<AlertDTO[]> {
  if (classId) {
    await requireProfessor(userId, classId);
    const { rows } = await pool.query<AlertRow>(
      `SELECT a.id, a.class_id, a.session_id, a.user_id, a.kind, a.message,
              a.channels_sent, a.created_at, a.read_at,
              u.name AS student_name, u.email AS student_email,
              c.name AS class_name
         FROM alerts a
         JOIN classes c ON c.id = a.class_id
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.class_id = $1
        ORDER BY a.created_at DESC`,
      [classId],
    );
    return rows.map(mapAlertRow);
  }

  // Find classes where user is an approved professor
  const { rows: profClasses } = await pool.query<{ class_id: string }>(
    `SELECT class_id FROM enrollments WHERE user_id = $1 AND role = 'professor' AND status = 'approved'`,
    [userId],
  );

  if (!profClasses.length) {
    throw new HttpError(403, 'forbidden', 'Only a professor can access alerts.');
  }

  const classIds = profClasses.map((c) => c.class_id);
  const { rows } = await pool.query<AlertRow>(
    `SELECT a.id, a.class_id, a.session_id, a.user_id, a.kind, a.message,
            a.channels_sent, a.created_at, a.read_at,
            u.name AS student_name, u.email AS student_email,
            c.name AS class_name
       FROM alerts a
       JOIN classes c ON c.id = a.class_id
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.class_id = ANY($1::uuid[])
      ORDER BY a.created_at DESC`,
    [classIds],
  );

  return rows.map(mapAlertRow);
}

/**
 * Marks an alert as read. Only an approved professor of the alert's class can mark it read.
 */
export async function markAlertRead(alertId: string, userId: string): Promise<AlertDTO> {
  const { rows: existingRows } = await pool.query<{ id: string; class_id: string }>(
    `SELECT id, class_id FROM alerts WHERE id = $1`,
    [alertId],
  );

  const existing = existingRows[0];
  if (!existing) {
    throw new HttpError(404, 'not_found', 'Alert not found');
  }

  await requireProfessor(userId, existing.class_id);

  const { rows: updatedRows } = await pool.query<AlertRow>(
    `UPDATE alerts
        SET read_at = COALESCE(read_at, now())
      WHERE id = $1
     RETURNING id, class_id, session_id, user_id, kind, message, channels_sent, created_at, read_at`,
    [alertId],
  );

  // Fetch student/class info
  const { rows: metaRows } = await pool.query<{
    class_name: string;
    student_name: string | null;
    student_email: string | null;
  }>(
    `SELECT c.name AS class_name, u.name AS student_name, u.email AS student_email
       FROM classes c
       JOIN alerts a ON a.class_id = c.id
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.id = $1`,
    [alertId],
  );

  const meta = metaRows[0];
  return mapAlertRow({
    ...updatedRows[0]!,
    class_name: meta?.class_name,
    student_name: meta?.student_name,
    student_email: meta?.student_email,
  });
}

/**
 * Helper to mark all unread alerts for a professor or class as read.
 */
export async function markAllAlertsRead(userId: string, classId?: string): Promise<{ count: number }> {
  if (classId) {
    await requireProfessor(userId, classId);
    const { rowCount } = await pool.query(
      `UPDATE alerts SET read_at = now() WHERE class_id = $1 AND read_at IS NULL`,
      [classId],
    );
    return { count: rowCount ?? 0 };
  }

  const { rows: profClasses } = await pool.query<{ class_id: string }>(
    `SELECT class_id FROM enrollments WHERE user_id = $1 AND role = 'professor' AND status = 'approved'`,
    [userId],
  );

  if (!profClasses.length) {
    throw new HttpError(403, 'forbidden', 'Only a professor can access alerts.');
  }

  const classIds = profClasses.map((c) => c.class_id);
  const { rowCount } = await pool.query(
    `UPDATE alerts SET read_at = now() WHERE class_id = ANY($1::uuid[]) AND read_at IS NULL`,
    [classIds],
  );

  return { count: rowCount ?? 0 };
}
