import { randomInt } from 'node:crypto';
import {
  CLASS_CODE_ALPHABET,
  CLASS_CODE_LENGTH,
  type ClassDetailDTO,
  type CreateClassInput,
  type EnrollmentDTO,
  type MyClassDTO,
  type UpdateEnrollmentInput,
} from '@notifeye/shared';
import { pool } from '../../db';
import { HttpError } from '../../shared/errors';

/** Every query here is parameterized: user input is only ever passed as $n values. */

export function generateClassCode(): string {
  let code = '';
  for (let i = 0; i < CLASS_CODE_LENGTH; i++) {
    code += CLASS_CODE_ALPHABET[randomInt(CLASS_CODE_ALPHABET.length)];
  }
  return code;
}

/** Accepts "abcd 2345", "ABCD-2345" etc. Anything else simply will not match a class. */
export function normalizeClassCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

const MY_CLASS_COLUMNS = `
  c.id, c.name, c.section, c.platform, e.role, e.status,
  CASE WHEN e.role = 'professor' THEN c.class_code ELSE NULL END AS class_code`;

export async function createClass(userId: string, input: CreateClassInput): Promise<ClassDetailDTO> {
  const client = await pool.connect();
  try {
    // The class code is unique; on the (very unlikely) collision, retry with a new code.
    for (let attempt = 0; attempt < 5; attempt++) {
      await client.query('BEGIN');
      try {
        const created = await client.query<{ id: string }>(
          `INSERT INTO classes (name, section, platform, class_code, owner_id, discord_webhook_url)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [input.name, input.section, input.platform, generateClassCode(), userId, input.discord_webhook_url],
        );
        const classId = created.rows[0]!.id;
        // The creator becomes the professor OF THIS CLASS (a per-class role, not a global one).
        await client.query(
          `INSERT INTO enrollments (user_id, class_id, role, status) VALUES ($1, $2, 'professor', 'approved')`,
          [userId, classId],
        );
        await client.query('COMMIT');
        const detail = await getClassDetail(userId, classId);
        return detail!;
      } catch (err) {
        await client.query('ROLLBACK');
        if (isUniqueViolation(err) && attempt < 4) continue;
        throw err;
      }
    }
    throw new Error('could not allocate a unique class code');
  } finally {
    client.release();
  }
}

/** Classes the user belongs to (not removed), each with THEIR role and status in that class. */
export async function listMyClasses(userId: string): Promise<MyClassDTO[]> {
  const { rows } = await pool.query<MyClassDTO>(
    `SELECT ${MY_CLASS_COLUMNS}
       FROM enrollments e JOIN classes c ON c.id = e.class_id
      WHERE e.user_id = $1 AND e.status <> 'removed'
      ORDER BY c.created_at DESC`,
    [userId],
  );
  return rows;
}

/**
 * One class as seen by a member. `discord_webhook_url` is included ONLY when the viewer owns the class
 * and is its professor; for everyone else the key is absent. It is never logged anywhere.
 */
export async function getClassDetail(userId: string, classId: string): Promise<ClassDetailDTO | null> {
  const { rows } = await pool.query<ClassDetailDTO & { webhook: string | null; is_owner: boolean }>(
    `SELECT ${MY_CLASS_COLUMNS}, c.owner_id,
            c.discord_webhook_url AS webhook,
            (c.owner_id = $1 AND e.role = 'professor') AS is_owner
       FROM enrollments e JOIN classes c ON c.id = e.class_id
      WHERE e.user_id = $1 AND e.class_id = $2 AND e.status <> 'removed'`,
    [userId, classId],
  );
  const row = rows[0];
  if (!row) return null;
  const { webhook, is_owner, ...detail } = row;
  return is_owner ? { ...detail, discord_webhook_url: webhook } : detail;
}

export type JoinResult = { created: boolean; class: MyClassDTO };

/**
 * Join by class code. Caller has already checked consent. An unknown code is a generic 404 (same
 * body for every miss). A new join is a PENDING student enrollment carrying the consent timestamp;
 * joining again is idempotent; a student the professor removed cannot rejoin by code.
 */
export async function joinClass(userId: string, rawCode: string): Promise<JoinResult> {
  const code = normalizeClassCode(rawCode);
  const found = await pool.query<{ id: string }>('SELECT id FROM classes WHERE class_code = $1', [code]);
  const classId = found.rows[0]?.id;
  if (!classId) throw new HttpError(404, 'not_found', 'Class not found');

  const existing = await pool.query<{ status: string }>(
    'SELECT status FROM enrollments WHERE user_id = $1 AND class_id = $2',
    [userId, classId],
  );
  if (existing.rows[0]?.status === 'removed') {
    throw new HttpError(403, 'removed_from_class', 'You were removed from this class. Ask your professor.');
  }

  const inserted = await pool.query(
    `INSERT INTO enrollments (user_id, class_id, role, status, consent_at)
     VALUES ($1, $2, 'student', 'pending', now())
     ON CONFLICT (user_id, class_id) DO NOTHING
     RETURNING id`,
    [userId, classId],
  );

  const { rows } = await pool.query<MyClassDTO>(
    `SELECT ${MY_CLASS_COLUMNS}
       FROM enrollments e JOIN classes c ON c.id = e.class_id
      WHERE e.user_id = $1 AND e.class_id = $2`,
    [userId, classId],
  );
  return { created: (inserted.rowCount ?? 0) > 0, class: rows[0]! };
}

export async function listEnrollments(classId: string): Promise<EnrollmentDTO[]> {
  const { rows } = await pool.query<EnrollmentDTO>(
    `SELECT e.id, e.user_id, u.name, u.email, e.role, e.status, e.consent_at, e.created_at
       FROM enrollments e JOIN users u ON u.id = e.user_id
      WHERE e.class_id = $1
      ORDER BY (e.role = 'professor') DESC, e.created_at ASC`,
    [classId],
  );
  return rows;
}

/** Approve or remove a STUDENT of this class. The enrollment must belong to this very class. */
export async function updateStudentEnrollment(
  classId: string,
  enrollmentId: string,
  input: UpdateEnrollmentInput,
): Promise<EnrollmentDTO> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE enrollments SET status = $3
      WHERE id = $1 AND class_id = $2 AND role = 'student'
      RETURNING id`,
    [enrollmentId, classId, input.status],
  );
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Not found');
  const all = await listEnrollments(classId);
  return all.find((e) => e.id === enrollmentId)!;
}

export async function createSession(
  userId: string,
  classId: string,
  input: import('@notifeye/shared').CreateSessionInput,
): Promise<import('@notifeye/shared').SessionDTO> {
  const meetingId = (await import('@notifeye/shared')).extractMeetingId(input.meeting_link);
  const { rows } = await pool.query<import('@notifeye/shared').SessionDTO>(
    `INSERT INTO class_sessions (class_id, starts_at, ends_at, meeting_link, meeting_id, grace_minutes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, class_id, starts_at, ends_at, meeting_link, meeting_id, grace_minutes, summary_sent_at, finalized_at, created_at`,
    [classId, input.starts_at, input.ends_at, input.meeting_link, meetingId, input.grace_minutes],
  );
  return rows[0]!;
}

export async function listSessions(classId: string): Promise<import('@notifeye/shared').SessionDTO[]> {
  const { rows } = await pool.query<import('@notifeye/shared').SessionDTO>(
    `SELECT id, class_id, starts_at, ends_at, meeting_link, meeting_id, grace_minutes, summary_sent_at, finalized_at, created_at
       FROM class_sessions
      WHERE class_id = $1
      ORDER BY starts_at ASC`,
    [classId],
  );
  return rows;
}

export async function getStudentSchedule(
  userId: string,
): Promise<import('@notifeye/shared').StudentScheduleItemDTO[]> {
  const { rows } = await pool.query<import('@notifeye/shared').StudentScheduleItemDTO>(
    `SELECT s.id, s.class_id, c.name AS class_name, c.section, c.platform,
            s.starts_at, s.ends_at, s.meeting_link, s.meeting_id, s.grace_minutes
       FROM class_sessions s
       JOIN classes c ON c.id = s.class_id
       JOIN enrollments e ON e.class_id = c.id
      WHERE e.user_id = $1 AND e.status = 'approved'
      ORDER BY s.starts_at ASC`,
    [userId],
  );
  return rows;
}

