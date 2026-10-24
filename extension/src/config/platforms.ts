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
