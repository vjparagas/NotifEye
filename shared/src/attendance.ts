import { z } from 'zod';

export type AttendanceStatus = 'present' | 'late' | 'absent';
export type AttendanceSource = 'extension' | 'zoom_api' | 'meet_api' | 'csv' | 'manual';

export interface AttendanceRecordDTO {
  id: string;
  session_id: string;
  user_id: string;
  student_name: string;
  student_email: string;
  joined_at: string | null;
  left_at: string | null;
  status: AttendanceStatus;
  source: AttendanceSource;
  overridden_by: string | null;
  overridden_at: string | null;
  conflict: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface StudentAttendanceDTO {
  id: string;
  session_id: string;
  class_id: string;
  class_name: string;
  starts_at: string;
  ends_at: string;
  status: AttendanceStatus;
  joined_at: string | null;
  left_at: string | null;
  source: string;
  created_at: string;
}

export interface AttendanceAuditDTO {
  id: string;
  attendance_id: string;
  actor_id: string | null;
  actor_name: string | null;
  old_status: string | null;
  new_status: string;
  reason: string | null;
  created_at: string;
}

export const overrideAttendanceSchema = z.object({
  status: z.enum(['present', 'late', 'absent']),
  reason: z.string().trim().max(500).optional(),
});
export type OverrideAttendanceInput = z.infer<typeof overrideAttendanceSchema>;

export interface SessionWindowWithGrace {
  starts_at: string;
  ends_at: string;
  grace_minutes: number;
}

export interface AttendanceCalcResult {
  status: AttendanceStatus | null;
  isLateFlipFromAbsent: boolean;
}

/**
 * Pure attendance calculation function per NotifEye Implementation Plan Section 5.
 * Rules:
 * - first_join <= starts_at + grace -> Present.
 * - first_join > starts_at + grace and before ends_at -> Late.
 * - No join by starts_at + grace -> Absent (shown at the end of the grace period). Finalized at ends_at.
 * - A join arriving after the Absent mark (before ends_at) flips the record to Late, audited.
 * - Overrides are written to attendance_audit, set overridden_by, and are never auto-reverted by later events.
 */
export function calculateAttendanceStatus(
  session: SessionWindowWithGrace,
  firstJoinTime: string | Date | null,
  currentStatus: AttendanceStatus | null = null,
  isOverridden = false,
  now: Date = new Date(),
): AttendanceCalcResult {
  if (isOverridden && currentStatus) {
    return {
      status: currentStatus,
      isLateFlipFromAbsent: false,
    };
  }

  const startMs = new Date(session.starts_at).getTime();
  const graceMs = session.grace_minutes * 60 * 1000;
  const graceBoundaryMs = startMs + graceMs;
  const endMs = new Date(session.ends_at).getTime();
  const nowMs = now.getTime();

  if (firstJoinTime) {
    const firstJoinMs = new Date(firstJoinTime).getTime();

    if (firstJoinMs <= graceBoundaryMs) {
      return {
        status: 'present',
        isLateFlipFromAbsent: false,
      };
    }

    if (firstJoinMs > graceBoundaryMs && firstJoinMs <= endMs) {
      const isLateFlip = currentStatus === 'absent';
      return {
        status: 'late',
        isLateFlipFromAbsent: isLateFlip,
      };
    }

    // Joined after session ends
    return {
      status: currentStatus ?? 'absent',
      isLateFlipFromAbsent: false,
    };
  }

  // No join yet:
  if (nowMs >= graceBoundaryMs) {
    return {
      status: 'absent',
      isLateFlipFromAbsent: false,
    };
  }

  return {
    status: null,
    isLateFlipFromAbsent: false,
  };
}
