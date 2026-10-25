import type { Platform } from '@notifeye/shared';

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  EDIT HERE when Zoom or Google Meet change their web-client URLs.        │
 * │  This is the single source of truth for:                                 │
 * │    • the manifest's content_scripts.matches + host_permissions           │
 * │    • extracting a meeting ID from the page URL                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 * Only Zoom (web client) and Google Meet are supported. Microsoft Teams is NOT supported.
 *
 * Privacy: the meeting ID is read from the page URL only (never page content). It is compared
 * on-device to the scheduled session; a non-matching meeting is discarded and never sent.
 */
export interface PlatformConfig {
  id: Platform;
  label: string;
  /** Chrome match patterns. Used for both content-script injection and host permission. */
  matches: string[];
  /** Hostname test applied before any path pattern. */
  hostPattern: RegExp;
  /** Applied to location.pathname. Capture group 1 is the meeting ID. */
  meetingIdPatterns: RegExp[];
}

export const PLATFORMS: readonly PlatformConfig[] = [
  {
    id: 'zoom',
    label: 'Zoom (web client)',
    // Web client only: https://app.zoom.us/wc/<id>/join, https://zoom.us/wc/join/<id>, ...
    matches: ['https://*.zoom.us/wc/*'],
    hostPattern: /(^|\.)zoom\.us$/,
    meetingIdPatterns: [/^\/wc\/(?:join\/)?(\d{9,11})(?:\/|$)/],
  },
  {
    id: 'meet',
    label: 'Google Meet',
    // Meeting codes look like abc-defg-hij
    matches: ['https://meet.google.com/*'],
    hostPattern: /^meet\.google\.com$/,
    meetingIdPatterns: [/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/],
  },
];

/** Every match pattern across platforms (for the manifest). */
export const ALL_MATCH_PATTERNS: string[] = PLATFORMS.flatMap((p) => p.matches);

/**
 * Extracts platform and meeting ID from a page URL.
 * Passcode parameters and queries are completely stripped.
 * Returns null if the URL does not match a supported meeting page.
 */
export function extractPlatformAndMeetingId(urlStr: string): { platform: Platform; meetingId: string } | null {
  try {
    const url = new URL(urlStr);
    for (const p of PLATFORMS) {
      if (!p.hostPattern.test(url.hostname)) continue;
      for (const pattern of p.meetingIdPatterns) {
        const match = url.pathname.match(pattern);
        if (match && match[1]) {
          return {
            platform: p.id,
            meetingId: match[1].toLowerCase(),
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Grace window before treating meeting as left when heartbeats stop (50s). */
export const HEARTBEAT_TIMEOUT_MS = 50_000;

export interface ScheduleItemForMatch {
  id: string;
  class_id: string;
  starts_at: string;
  ends_at: string;
  meeting_id: string | null;
}

/**
 * Pure function: compares meeting ID with the scheduled session's meeting_id.
 * Returns the matching session if inside window and meeting ID matches;
 * otherwise returns null (meaning it must be dropped in memory and send nothing).
 */
export function matchMeetingToSchedule<T extends ScheduleItemForMatch>(
  meetingId: string,
  schedule: T[],
  nowMs: number = Date.now(),
): T | null {
  return (
    schedule.find((s) => {
      const start = new Date(s.starts_at).getTime();
      const end = new Date(s.ends_at).getTime();
      if (nowMs < start || nowMs > end) return false;
      if (!s.meeting_id) return false;
      return s.meeting_id.toLowerCase() === meetingId.toLowerCase();
    }) ?? null
  );
}

/**
 * Pure function: checks if heartbeats have stopped longer than the grace window.
 * Ensures a service-worker restart does NOT produce a false meeting_left.
 */
export function shouldHeartbeatTimeout(
  lastHeartbeatAt: number,
  nowMs: number = Date.now(),
  timeoutMs: number = HEARTBEAT_TIMEOUT_MS,
): boolean {
  return nowMs - lastHeartbeatAt > timeoutMs;
}
