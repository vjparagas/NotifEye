import type { UserDataExportDTO } from '@notifeye/shared';
import { pool } from '../../db';
import { HttpError } from '../../shared/errors';

export async function getUserDataExport(userId: string): Promise<UserDataExportDTO> {
  // 1. Profile and consent
  const { rows: userRows } = await pool.query<{
    id: string;
    email: string;
    name: string;
    consent_at: Date | null;
    consent_version: string | null;
    created_at: Date;
  }>(
    `SELECT id, email, name, consent_at, consent_version, created_at
       FROM users
      WHERE id = $1`,
    [userId],
  );

  const user = userRows[0];
  if (!user) {
    throw new HttpError(404, 'not_found', 'User not found');
  }

  // 2. Enrollments
  const { rows: enrollRows } = await pool.query<{
    id: string;
    class_id: string;
    class_name: string;
    role: string;
    status: string;
    consent_at: Date | null;
    created_at: Date;
  }>(
    `SELECT e.id, e.class_id, c.name AS class_name, e.role, e.status, e.consent_at, e.created_at
       FROM enrollments e
       JOIN classes c ON c.id = e.class_id
      WHERE e.user_id = $1
      ORDER BY e.created_at DESC`,
    [userId],
  );

  // 3. Attendance records
  const { rows: attendanceRows } = await pool.query<{
    id: string;
    session_id: string;
    class_name: string;
    session_starts_at: Date;
    session_ends_at: Date;
    joined_at: Date | null;
    left_at: Date | null;
    status: string;
    source: string;
    overridden_at: Date | null;
    created_at: Date;
  }>(
    `SELECT ar.id, ar.session_id, c.name AS class_name,
            cs.starts_at AS session_starts_at, cs.ends_at AS session_ends_at,
            ar.joined_at, ar.left_at, ar.status, ar.source, ar.overridden_at, ar.created_at
       FROM attendance_records ar
       JOIN class_sessions cs ON cs.id = ar.session_id
       JOIN classes c ON c.id = cs.class_id
      WHERE ar.user_id = $1
      ORDER BY cs.starts_at DESC`,
    [userId],
  );

  // 4. Activity events
  const { rows: eventRows } = await pool.query<{
    id: string;
    class_id: string;
    session_id: string | null;
    type: string;
    state: string | null;
    timestamp: Date;
    source: string;
    received_at: Date;
  }>(
    `SELECT id, class_id, session_id, type, state, timestamp, source, received_at
       FROM activity_events
      WHERE user_id = $1
      ORDER BY timestamp DESC`,
    [userId],
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      consent_at: user.consent_at ? user.consent_at.toISOString() : null,
      consent_version: user.consent_version,
      created_at: user.created_at.toISOString(),
    },
    enrollments: enrollRows.map((e) => ({
      id: e.id,
      class_id: e.class_id,
      class_name: e.class_name,
      role: e.role,
      status: e.status,
      consent_at: e.consent_at ? e.consent_at.toISOString() : null,
      created_at: e.created_at.toISOString(),
    })),
    attendance: attendanceRows.map((a) => ({
      id: a.id,
      session_id: a.session_id,
      class_name: a.class_name,
      session_starts_at: a.session_starts_at.toISOString(),
      session_ends_at: a.session_ends_at.toISOString(),
      joined_at: a.joined_at ? a.joined_at.toISOString() : null,
      left_at: a.left_at ? a.left_at.toISOString() : null,
      status: a.status,
      source: a.source,
      overridden_at: a.overridden_at ? a.overridden_at.toISOString() : null,
      created_at: a.created_at.toISOString(),
    })),
    events: eventRows.map((ev) => ({
      id: ev.id,
      class_id: ev.class_id,
      session_id: ev.session_id,
      type: ev.type,
      state: ev.state,
      timestamp: ev.timestamp.toISOString(),
      source: ev.source,
      received_at: ev.received_at.toISOString(),
    })),
  };
}
