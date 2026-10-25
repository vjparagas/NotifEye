import { z } from 'zod';
import type { EnrollmentRole, EnrollmentStatus } from '@notifeye/shared';
import { pool } from '../db';
import { HttpError } from './errors';

/**
 * Per-class access control. There is NO global role anywhere: the only source of truth for "what can
 * this user do in this class" is their row in `enrollments` for THAT class.
 *
 * Denial semantics (so a user can never probe which classes exist):
 *   - not a member (or removed)          -> 404 not_found   (looks exactly like a missing class)
 *   - member without the needed role     -> 403 forbidden
 */
export interface Membership {
  role: EnrollmentRole;
  status: EnrollmentStatus;
}

const uuid = z.uuid();

/** Route params are untrusted: a malformed id is simply "not found" (and never reaches SQL). */
export function parseId(value: unknown): string {
  const r = uuid.safeParse(value);
  if (!r.success) throw new HttpError(404, 'not_found', 'Not found');
  return r.data;
}

export async function getMembership(userId: string, classId: string): Promise<Membership | null> {
  const { rows } = await pool.query<Membership>(
    'SELECT role, status FROM enrollments WHERE user_id = $1 AND class_id = $2',
    [userId, classId],
  );
  return rows[0] ?? null;
}

/** Any current member (pending or approved). Removed or non-members get 404. */
export async function requireMember(userId: string, classId: string): Promise<Membership> {
  const m = await getMembership(userId, classId);
  if (!m || m.status === 'removed') throw new HttpError(404, 'not_found', 'Not found');
  return m;
}

/** An approved professor OF THIS CLASS. Being a professor in another class grants nothing here. */
export async function requireProfessor(userId: string, classId: string): Promise<Membership> {
  const m = await requireMember(userId, classId);
  if (m.role !== 'professor' || m.status !== 'approved') {
    throw new HttpError(403, 'forbidden', 'Only a professor of this class can do that.');
  }
  return m;
}
