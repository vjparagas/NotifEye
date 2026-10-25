import { describe, expect, it } from 'vitest';
import {
  extractPlatformAndMeetingId,
  matchMeetingToSchedule,
  shouldHeartbeatTimeout,
  HEARTBEAT_TIMEOUT_MS,
  type ScheduleItemForMatch,
} from '../../extension/src/config/platforms';
import { extractMeetingId } from '@notifeye/shared';

describe('Phase 4B: Extension Meeting Detection, URL Extractors, and Heartbeat Lifecycle', () => {
  describe('1. URL & Meeting ID Extractors (Zoom web client & Google Meet)', () => {
    it('extracts Google Meet codes and strips passcodes and query params', () => {
      // Standard Meet URL
      const r1 = extractPlatformAndMeetingId('https://meet.google.com/abc-defg-hij');
      expect(r1).toEqual({ platform: 'meet', meetingId: 'abc-defg-hij' });

      // Meet URL with query parameters (authuser, pwd, etc.)
      const r2 = extractPlatformAndMeetingId('https://meet.google.com/abc-defg-hij?authuser=1&pwd=secretpasscode');
      expect(r2).toEqual({ platform: 'meet', meetingId: 'abc-defg-hij' });

      // Shared meeting ID extractor
      expect(extractMeetingId('https://meet.google.com/abc-defg-hij?pwd=xyz')).toBe('abc-defg-hij');

      // Non-meeting Meet pages return null
      expect(extractPlatformAndMeetingId('https://meet.google.com/')).toBeNull();
      expect(extractPlatformAndMeetingId('https://meet.google.com/landing')).toBeNull();
      expect(extractPlatformAndMeetingId('https://meet.google.com/about')).toBeNull();
    });

    it('extracts Zoom web client meeting IDs and strips passcodes/queries', () => {
      // Zoom web client /wc/<id>/join with query password
      const r1 = extractPlatformAndMeetingId('https://app.zoom.us/wc/12345678901/join?pwd=mysecretpasscode');
      expect(r1).toEqual({ platform: 'zoom', meetingId: '12345678901' });

      // Zoom web client /wc/join/<id>
      const r2 = extractPlatformAndMeetingId('https://zoom.us/wc/join/98765432100');
      expect(r2).toEqual({ platform: 'zoom', meetingId: '98765432100' });

      // Zoom subdomains (e.g. us05web.zoom.us)
      const r3 = extractPlatformAndMeetingId('https://us05web.zoom.us/wc/55566677788/join');
      expect(r3).toEqual({ platform: 'zoom', meetingId: '55566677788' });

      // Shared meeting ID extractor
      expect(extractMeetingId('https://zoom.us/wc/12345678901/join?pwd=xyz')).toBe('12345678901');

      // Non-wc Zoom pages return null (content script does not match these)
      expect(extractPlatformAndMeetingId('https://zoom.us/signin')).toBeNull();
      expect(extractPlatformAndMeetingId('https://zoom.us/pricing')).toBeNull();

      // Unsupported platforms return null (MS Teams is out of scope)
      expect(extractPlatformAndMeetingId('https://teams.microsoft.com/l/meetup-join/xyz')).toBeNull();
    });
  });

  describe('2. Meeting Session Matching: Mismatch & Out-of-Window Drop Logic', () => {
    const schedule: ScheduleItemForMatch[] = [
      {
        id: 'session-math-1',
        class_id: 'class-math-101',
        starts_at: '2026-10-25T14:00:00.000Z',
        ends_at: '2026-10-25T15:00:00.000Z',
        meeting_id: 'abc-defg-hij',
      },
    ];

    it('mismatch meeting ID returns null (dropped in memory, sends nothing)', () => {
      // Current time is inside session (14:15), but student joined an unrelated meeting 'xyz-uvwx-rst'
      const nowMs = new Date('2026-10-25T14:15:00.000Z').getTime();
      const match = matchMeetingToSchedule('xyz-uvwx-rst', schedule, nowMs);

      expect(match).toBeNull();
    });

    it('heartbeat outside session window returns null (dropped in memory, sends nothing)', () => {
      // Meeting ID matches 'abc-defg-hij', but time is 13:50 (before session starts at 14:00)
      const beforeStartMs = new Date('2026-10-25T13:50:00.000Z').getTime();
      const matchBefore = matchMeetingToSchedule('abc-defg-hij', schedule, beforeStartMs);
      expect(matchBefore).toBeNull();

      // After session ends at 15:00 (15:05)
      const afterEndMs = new Date('2026-10-25T15:05:00.000Z').getTime();
      const matchAfter = matchMeetingToSchedule('abc-defg-hij', schedule, afterEndMs);
      expect(matchAfter).toBeNull();
    });

    it('matching meeting ID inside session window returns the scheduled session', () => {
      const insideWindowMs = new Date('2026-10-25T14:05:00.000Z').getTime();
      const match = matchMeetingToSchedule('abc-defg-hij', schedule, insideWindowMs);

      expect(match).not.toBeNull();
      expect(match?.id).toBe('session-math-1');
      expect(match?.class_id).toBe('class-math-101');
    });

    it('case-insensitive meeting ID matching', () => {
      const insideWindowMs = new Date('2026-10-25T14:05:00.000Z').getTime();
      const match = matchMeetingToSchedule('ABC-DEFG-HIJ', schedule, insideWindowMs);

      expect(match).not.toBeNull();
      expect(match?.id).toBe('session-math-1');
    });
  });

  describe('3. Service Worker Restart & Heartbeat Grace Lifecycle', () => {
    it('a service-worker restart does NOT create a false meeting_left', () => {
      // Meeting was active before service worker restart
      const lastHeartbeatTime = 1_000_000;
      // Service worker restarts 25s later:
      const restartTime = lastHeartbeatTime + 25_000;

      // Because heartbeats arrive every ~20s, 25s is well within the 50s grace window
      const isTimedOut = shouldHeartbeatTimeout(lastHeartbeatTime, restartTime, HEARTBEAT_TIMEOUT_MS);
      expect(isTimedOut).toBe(false);
    });

    it('heartbeats stopping longer than the grace window (50s) triggers timeout', () => {
      const lastHeartbeatTime = 1_000_000;
      // 55s have elapsed without a heartbeat (> 50s grace window)
      const nowMs = lastHeartbeatTime + 55_000;

      const isTimedOut = shouldHeartbeatTimeout(lastHeartbeatTime, nowMs, HEARTBEAT_TIMEOUT_MS);
      expect(isTimedOut).toBe(true);
    });
  });
});
