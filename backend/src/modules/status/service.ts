import { computeStudentStatus, type NormalizedEvent, type StudentStatusDTO } from '@notifeye/shared';
import { pool } from '../../db';

export async function getClassStatus(classId: string, now: Date = new Date()): Promise<StudentStatusDTO[]> {
  const nowIso = now.toISOString();

  // 1. Check if there is an active session window for this class right now
  const { rows: sessionRows } = await pool.query<{ id: string; starts_at: Date; ends_at: Date }>(
    `SELECT id, starts_at, ends_at FROM class_sessions
      WHERE class_id = $1 AND starts_at <= $2 AND ends_at >= $2
      ORDER BY starts_at ASC LIMIT 1`,
    [classId, nowIso],
  );

  const activeSession = sessionRows[0]
    ? {
        starts_at: sessionRows[0].starts_at.toISOString(),
        ends_at: sessionRows[0].ends_at.toISOString(),
      }
    : null;

  // 2. Fetch all approved students in this class
  const { rows: students } = await pool.query<{ user_id: string; name: string; email: string }>(
    `SELECT u.id AS user_id, u.name, u.email
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
      WHERE e.class_id = $1 AND e.role = 'student' AND e.status = 'approved'
      ORDER BY u.name ASC`,
    [classId],
  );

  if (students.length === 0) return [];

  // 3. Fetch all activity events for this class up to `now`
  const { rows: events } = await pool.query<NormalizedEvent>(
    `SELECT user_id, class_id, session_id, type, state, timestamp, source
       FROM activity_events
      WHERE class_id = $1 AND timestamp <= $2
      ORDER BY timestamp ASC`,
    [classId, nowIso],
  );

  // Group events by student
  const eventsByUser = new Map<string, NormalizedEvent[]>();
  for (const ev of events) {
    let list = eventsByUser.get(ev.user_id);
    if (!list) {
      list = [];
      eventsByUser.set(ev.user_id, list);
    }
    list.push(ev);
  }

  // 4. Compute status for each student
  return students.map((s) => {
    const studentEvents = eventsByUser.get(s.user_id) ?? [];
    const computed = computeStudentStatus(studentEvents, activeSession, now);
    return {
      user_id: s.user_id,
      name: s.name,
      email: s.email,
      status: computed.status,
      source: computed.source,
      last_seen: computed.last_seen,
      last_state: computed.last_state,
      in_meeting: computed.in_meeting,
    };
  });
}
