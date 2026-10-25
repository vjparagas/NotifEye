import { z } from 'zod';
import { type Platform } from './events';

/**
 * Normalizes Zoom and Meet meeting links into a canonical meeting_id.
 * Google Meet: 10 lowercase letters with hyphens (e.g. "abc-defg-hij").
 * Zoom: 9 to 11 digits (passcodes and query parameters stripped).
 */
export function extractMeetingId(link: string): string | null {
  try {
    const url = new URL(link);
    const path = url.pathname;

    // Meet: /abc-defg-hij
    const meetMatch = path.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/i);
    if (meetMatch && meetMatch[1]) {
      return meetMatch[1].toLowerCase();
    }

    // Zoom: /wc/1234567890/join, /wc/join/1234567890, /j/1234567890
    const zoomMatch = path.match(/\/(?:wc\/(?:join\/)?|j\/)?(\d{9,11})(?:\/|$)/);
    if (zoomMatch && zoomMatch[1]) {
      return zoomMatch[1];
    }

    // Fallback: any 9-11 digit sequence in the path
    const digitMatch = path.match(/(\d{9,11})/);
    if (digitMatch && digitMatch[1]) {
      return digitMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

export const createSessionSchema = z
  .object({
    starts_at: z.string().datetime({ message: 'starts_at must be a valid ISO 8601 timestamp' }),
    ends_at: z.string().datetime({ message: 'ends_at must be a valid ISO 8601 timestamp' }),
    meeting_link: z.string().url('Must be a valid meeting URL').max(500),
    grace_minutes: z.coerce.number().int().min(0, 'Grace period cannot be negative').default(10),
  })
  .refine(
    (data) => new Date(data.ends_at).getTime() > new Date(data.starts_at).getTime(),
    {
      message: 'ends_at must be later than starts_at',
      path: ['ends_at'],
    },
  );

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export interface SessionDTO {
  id: string;
  class_id: string;
  starts_at: string;
  ends_at: string;
  meeting_link: string;
  meeting_id: string | null;
  grace_minutes: number;
  summary_sent_at: string | null;
  finalized_at: string | null;
  created_at: string;
}

export interface StudentScheduleItemDTO {
  id: string;
  class_id: string;
  class_name: string;
  section: string | null;
  platform: Platform;
  starts_at: string;
  ends_at: string;
  meeting_link: string;
  meeting_id: string | null;
  grace_minutes: number;
}
