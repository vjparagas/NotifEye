import { z } from 'zod';

/**
 * Normalized event format. EVERY data source (browser extension, future Zoom/Meet APIs,
 * CSV import) is converted into this shape by the connector layer. Downstream services
 * (status, attendance, rules) only ever see `NormalizedEvent`.
 *
 * Privacy: this is the complete list of what is collected. Idle state and meeting
 * join/leave only — never page content, URLs, browsing history, or input data.
 */

export const EVENT_TYPES = ['meeting_joined', 'meeting_left', 'presence'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Device activity state, from chrome.idle. Only meaningful for `presence` events. */
export const PRESENCE_STATES = ['active', 'idle', 'locked'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

/** `zoom_api` / `meet_api` are reserved for future platform connectors. */
export const EVENT_SOURCES = ['extension', 'zoom_api', 'meet_api', 'csv'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export interface NormalizedEvent {
  user_id: string;
  class_id: string;
  session_id: string | null;
  type: EventType;
  /** Required for `presence`, null otherwise. */
  state: PresenceState | null;
  /** ISO-8601, the ORIGINAL device time (offline-queued events keep it). */
  timestamp: string;
  source: EventSource;
}

/** Supported meeting platforms. Microsoft Teams is intentionally NOT supported. */
export const PLATFORMS = ['zoom', 'meet'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const singleEventSchema = z
  .object({
    user_id: z.string().uuid(),
    class_id: z.string().uuid(),
    session_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
    type: z.enum(EVENT_TYPES),
    state: z.enum(PRESENCE_STATES).nullable().optional().transform((v) => v ?? null),
    timestamp: z.string().datetime({ message: 'timestamp must be a valid ISO 8601 string' }),
    source: z.enum(EVENT_SOURCES),
  })
  .refine(
    (ev) => {
      if (ev.type === 'presence') {
        return ev.state !== null;
      }
      return ev.state === null;
    },
    {
      message: 'state is required for presence events and must be null for meeting events',
      path: ['state'],
    },
  );

export const postEventsSchema = z.object({
  events: z.array(singleEventSchema).min(1, 'events batch cannot be empty').max(100, 'batch size limit 100'),
});
export type PostEventsInput = z.infer<typeof postEventsSchema>;

export const STATUS_KINDS = [
  'not_in_session',
  'in_class',
  'away',
  'idle',
  'online',
  'offline',
] as const;
export type StudentStatusKind = (typeof STATUS_KINDS)[number];

export interface StudentStatusDTO {
  user_id: string;
  name: string;
  email: string;
  status: StudentStatusKind;
  source: string;
  last_seen: string | null;
  last_state: PresenceState | null;
  in_meeting: boolean;
}
