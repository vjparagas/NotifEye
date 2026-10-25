import type { NormalizedEvent } from '@notifeye/shared';
import { pool } from '../../db';
import { HttpError } from '../../shared/errors';
import { processEventForAttendance } from '../attendance/service';

export interface IngestResult {
  received: number;
  inserted: number;
}

export async function ingestEvents(userId: string, events: NormalizedEvent[]): Promise<IngestResult> {
  if (events.length === 0) return { received: 0, inserted: 0 };

  // 1. Verify user consent
  const { rows: userRows } = await pool.query<{ consent_at: Date | null }>(
    'SELECT consent_at FROM users WHERE id = $1',
    [userId],
  );
  if (!userRows[0]?.consent_at) {
    throw new HttpError(400, 'consent_required', 'Consent required before submitting activity events.');
  }

  // Group events by class to minimize queries
  const eventsByClass = new Map<string, NormalizedEvent[]>();
  for (const ev of events) {
    if (ev.user_id !== userId) {
      throw new HttpError(403, 'forbidden', 'Cannot submit events for another user.');
    }
    let list = eventsByClass.get(ev.class_id);
    if (!list) {
      list = [];
      eventsByClass.set(ev.class_id, list);
    }
    list.push(ev);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let insertedCount = 0;

    for (const [classId, classEvents] of eventsByClass.entries()) {
      // 2. Verify approved student enrollment and enrollment consent
      const { rows: enrollRows } = await client.query<{ status: string; consent_at: Date | null; role: string }>(
        'SELECT status, consent_at, role FROM enrollments WHERE user_id = $1 AND class_id = $2',
        [userId, classId],
      );
      const enr = enrollRows[0];
      if (!enr || enr.status !== 'approved' || enr.role !== 'student') {
        throw new HttpError(403, 'forbidden', 'Must be an approved student in this class.');
      }
      if (!enr.consent_at) {
        throw new HttpError(400, 'consent_required', 'Class join consent required.');
      }

      // 3. For each event, check session window and insert
      for (const ev of classEvents) {
        const { rows: sessionRows } = await client.query<{
          id: string;
          starts_at: Date;
          ends_at: Date;
          grace_minutes: number;
        }>(
          `SELECT id, starts_at, ends_at, grace_minutes FROM class_sessions
            WHERE class_id = $1
              AND starts_at <= $2
              AND ends_at >= $2
            ORDER BY starts_at ASC LIMIT 1`,
          [classId, ev.timestamp],
        );

        if (!sessionRows[0]) {
          throw new HttpError(400, 'out_of_session', 'Event timestamp is outside any active session window.');
        }

        const session = sessionRows[0];
        const sessionId = session.id;
        const res = await client.query(
          `INSERT INTO activity_events (user_id, class_id, session_id, type, state, timestamp, source, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT (user_id, class_id, type, timestamp, source) DO NOTHING
           RETURNING id`,
          [ev.user_id, ev.class_id, sessionId, ev.type, ev.state, ev.timestamp, ev.source],
        );
        if ((res.rowCount ?? 0) > 0) {
          insertedCount++;
          if (ev.type === 'meeting_joined' || ev.type === 'meeting_left') {
            await processEventForAttendance(
              client,
              { ...ev, session_id: sessionId },
              {
                starts_at: session.starts_at,
                ends_at: session.ends_at,
                grace_minutes: session.grace_minutes,
              },
            );
          }
        }
      }
    }

    await client.query('COMMIT');
    return { received: events.length, inserted: insertedCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
