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
