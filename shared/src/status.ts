import type { NormalizedEvent, PresenceState, StudentStatusKind } from './events';

export interface SessionWindow {
  starts_at: string;
  ends_at: string;
}

export interface ComputedStatus {
  status: StudentStatusKind;
  source: string;
  last_seen: string | null;
  last_state: PresenceState | null;
  in_meeting: boolean;
}

const THREE_MINUTES_MS = 3 * 60 * 1000;

/**
 * Pure status computation function per NotifEye Implementation Plan Section 5.
 * Precedence (highest first):
 *   1. Not in session: outside any session window.
 *   2. Offline: no report for > 3 minutes. (Overrides stale In Class).
 *   3. In Class: meeting_joined with no later meeting_left, and reported within 3 minutes.
 *   4. Away: latest presence is locked.
 *   5. Idle: latest presence is idle.
 *   6. Online: active and reported within 3 minutes.
 *
 * @param events All events for this student in the class, sorted or unsorted.
 * @param session Current active session window, or null if no session.
 * @param now Injected clock timestamp.
 * @param _idleThresholdMinutes Configurable idle threshold (default 5 minutes).
 */
export function computeStudentStatus(
  events: NormalizedEvent[],
  session: SessionWindow | null,
  now: Date = new Date(),
  _idleThresholdMinutes = 5,
): ComputedStatus {
  const nowMs = now.getTime();

  // 1. Not in session: outside any session window
  if (!session) {
    return {
      status: 'not_in_session',
      source: 'system',
      last_seen: null,
      last_state: null,
      in_meeting: false,
    };
  }

  const sessionStartMs = new Date(session.starts_at).getTime();
  const sessionEndMs = new Date(session.ends_at).getTime();

  if (nowMs < sessionStartMs || nowMs > sessionEndMs) {
    return {
      status: 'not_in_session',
      source: 'system',
      last_seen: null,
      last_state: null,
      in_meeting: false,
    };
  }

  // Filter events up to `now`
  const validEvents = events
    .filter((ev) => {
      const t = new Date(ev.timestamp).getTime();
      return !Number.isNaN(t) && t <= nowMs;
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (validEvents.length === 0) {
    return {
      status: 'offline',
      source: 'extension',
      last_seen: null,
      last_state: null,
      in_meeting: false,
    };
  }

  // Latest event timestamp
  const latestEvent = validEvents[validEvents.length - 1]!;
  const latestTimeMs = new Date(latestEvent.timestamp).getTime();
  const lastSeenIso = latestEvent.timestamp;

  // Latest presence state
  const presenceEvents = validEvents.filter((e) => e.type === 'presence');
  const latestPresence = presenceEvents.length > 0 ? presenceEvents[presenceEvents.length - 1]! : null;
  const lastState = latestPresence?.state ?? null;

  // Meeting presence
  const meetingEvents = validEvents.filter((e) => e.type === 'meeting_joined' || e.type === 'meeting_left');
  const latestMeeting = meetingEvents.length > 0 ? meetingEvents[meetingEvents.length - 1]! : null;
  const inMeeting = latestMeeting?.type === 'meeting_joined';

  // 2. Offline check: no report for > 3 minutes.
  // CRITICAL (Plan §5 / Deviation #2): "Offline overrides a stale In Class. If the extension has not
  // reported for more than 3 minutes, the status is Offline even if a meeting tab was last seen open."
  const msSinceLastReport = nowMs - latestTimeMs;
  if (msSinceLastReport > THREE_MINUTES_MS) {
    return {
      status: 'offline',
      source: 'extension',
      last_seen: lastSeenIso,
      last_state: lastState,
      in_meeting: inMeeting,
    };
  }

  // 3. In Class: meeting open and report within 3 min
  if (inMeeting) {
    return {
      status: 'in_class',
      source: 'meeting tab',
      last_seen: lastSeenIso,
      last_state: lastState,
      in_meeting: true,
    };
  }

  // 4. Away: screen is locked
  if (lastState === 'locked') {
    return {
      status: 'away',
      source: 'extension',
      last_seen: lastSeenIso,
      last_state: 'locked',
      in_meeting: false,
    };
  }

  // 5. Idle: user is idle
  if (lastState === 'idle') {
    return {
      status: 'idle',
      source: 'extension',
      last_seen: lastSeenIso,
      last_state: 'idle',
      in_meeting: false,
    };
  }

  // 6. Online: active and reported within 3 min
  return {
    status: 'online',
    source: 'extension',
    last_seen: lastSeenIso,
    last_state: lastState ?? 'active',
    in_meeting: false,
  };
}
