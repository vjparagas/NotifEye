import type {
  NormalizedEvent,
  PresenceState,
  StudentScheduleItemDTO,
  UserDTO,
} from '@notifeye/shared';
import {
  HEARTBEAT_TIMEOUT_MS,
  matchMeetingToSchedule,
  shouldHeartbeatTimeout,
} from '../config/platforms';
import { REMINDER_ALARM_PREFIX, scheduleReminders } from '../reminders';

const API_BASE = typeof __API_URL__ !== 'undefined' ? __API_URL__ : 'http://localhost:4000';
const IS_DEMO = typeof __DEMO_MODE__ !== 'undefined' ? __DEMO_MODE__ : false;

const TICK_ALARM = 'notifeye_tick';
const REFRESH_ALARM = 'notifeye_schedule_refresh';

export interface ActiveMeetingState {
  meetingId: string;
  classId: string;
  sessionId: string;
  lastHeartbeatAt: number;
}

/**
 * Downloads the student's schedule from GET /me/schedule and caches it in chrome.storage.local.
 */
export async function refreshSchedule(): Promise<StudentScheduleItemDTO[]> {
  try {
    const data = await chrome.storage.local.get(['notifeye_token']);
    const token = data.notifeye_token as string | undefined;
    if (!token) {
      await chrome.storage.local.set({ notifeye_schedule: [] });
      return [];
    }

    const res = await fetch(`${API_BASE}/me/schedule`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const body = (await res.json()) as { schedule: StudentScheduleItemDTO[] };
      const schedule = body.schedule ?? [];
      await chrome.storage.local.set({ notifeye_schedule: schedule });
      await scheduleReminders(schedule);
      return schedule;
    }
  } catch (err) {
    console.warn('[NotifEye SW] Schedule refresh failed:', err);
  }
  return [];
}

/**
 * Flushes queued offline events to the backend POST /events.
 */
export async function flushEventQueue(): Promise<void> {
  try {
    const data = await chrome.storage.local.get(['notifeye_token', 'notifeye_offline_queue']);
    const token = data.notifeye_token as string | undefined;
    const queue = (data.notifeye_offline_queue as NormalizedEvent[] | undefined) ?? [];

    if (!token || queue.length === 0) return;

    const res = await fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: queue }),
    });

    if (res.ok) {
      await chrome.storage.local.set({ notifeye_offline_queue: [] });
    }
  } catch {
    // Retain in storage on network failure
  }
}

/**
 * Handles meeting heartbeat from content script.
 * If meeting does not match scheduled session or is outside window: dropped in memory, sends nothing.
 * If matches: records heartbeat and queues meeting_joined on initial join.
 */
export async function handleMeetingHeartbeat(
  meetingId: string,
  timestamp?: string,
): Promise<{ matched: boolean; status: string }> {
  try {
    const data = await chrome.storage.local.get([
      'notifeye_token',
      'notifeye_user',
      'notifeye_schedule',
      'notifeye_active_meeting',
      'notifeye_offline_queue',
    ]);

    const token = data.notifeye_token as string | undefined;
    const user = data.notifeye_user as UserDTO | undefined;
    const schedule = (data.notifeye_schedule as StudentScheduleItemDTO[] | undefined) ?? [];
    const activeMeeting = (data.notifeye_active_meeting as ActiveMeetingState | undefined) ?? null;
    const offlineQueue = (data.notifeye_offline_queue as NormalizedEvent[] | undefined) ?? [];

    if (!token || !user) {
      return { matched: false, status: 'unauthenticated' };
    }

    const eventTimeIso = timestamp ?? new Date().toISOString();
    const eventTimeMs = new Date(eventTimeIso).getTime();

    // Check if there is an active session right now matching this meeting_id
    const matchingSession = matchMeetingToSchedule(meetingId, schedule, eventTimeMs);

    // Mismatch or outside session window: DROP in memory and send NOTHING!
    if (!matchingSession) {
      return { matched: false, status: 'dropped_mismatch_or_out_of_window' };
    }

    const updatedActive: ActiveMeetingState = {
      meetingId,
      classId: matchingSession.class_id,
      sessionId: matchingSession.id,
      lastHeartbeatAt: Date.now(),
    };

    // If already joined to this session: just update heartbeat timestamp
    if (
      activeMeeting &&
      activeMeeting.sessionId === matchingSession.id &&
      activeMeeting.meetingId.toLowerCase() === meetingId.toLowerCase()
    ) {
      await chrome.storage.local.set({ notifeye_active_meeting: updatedActive });
      return { matched: true, status: 'heartbeat_updated' };
    }

    // First time joining this meeting: queue meeting_joined event
    const joinEvent: NormalizedEvent = {
      user_id: user.id,
      class_id: matchingSession.class_id,
      session_id: matchingSession.id,
      type: 'meeting_joined',
      state: null,
      timestamp: eventTimeIso,
      source: 'extension',
    };

    const newQueue = [...offlineQueue, joinEvent].slice(-100);
    await chrome.storage.local.set({
      notifeye_active_meeting: updatedActive,
      notifeye_offline_queue: newQueue,
    });

    await flushEventQueue();
    return { matched: true, status: 'meeting_joined_queued' };
  } catch (err) {
    console.error('[NotifEye SW] handleMeetingHeartbeat error:', err);
    return { matched: false, status: 'error' };
  }
}

/**
 * Handles pagehide message from content script.
 * Emits meeting_left event and clears active meeting state.
 */
export async function handleMeetingPagehide(
  meetingId: string,
  timestamp?: string,
): Promise<{ handled: boolean }> {
  try {
    const data = await chrome.storage.local.get([
      'notifeye_token',
      'notifeye_user',
      'notifeye_active_meeting',
      'notifeye_offline_queue',
    ]);

    const token = data.notifeye_token as string | undefined;
    const user = data.notifeye_user as UserDTO | undefined;
    const activeMeeting = (data.notifeye_active_meeting as ActiveMeetingState | undefined) ?? null;
    const offlineQueue = (data.notifeye_offline_queue as NormalizedEvent[] | undefined) ?? [];

    if (!token || !user || !activeMeeting) {
      return { handled: false };
    }

    if (activeMeeting.meetingId.toLowerCase() !== meetingId.toLowerCase()) {
      return { handled: false };
    }

    const leaveEvent: NormalizedEvent = {
      user_id: user.id,
      class_id: activeMeeting.classId,
      session_id: activeMeeting.sessionId,
      type: 'meeting_left',
      state: null,
      timestamp: timestamp ?? new Date().toISOString(),
      source: 'extension',
    };

    const newQueue = [...offlineQueue, leaveEvent].slice(-100);
    await chrome.storage.local.set({
      notifeye_active_meeting: null,
      notifeye_offline_queue: newQueue,
    });

    await flushEventQueue();
    return { handled: true };
  } catch (err) {
    console.error('[NotifEye SW] handleMeetingPagehide error:', err);
    return { handled: false };
  }
}

/**
 * Checks if meeting heartbeats have stopped longer than the grace window (50s).
 * NEVER treats a port disconnect or service-worker restart as "left".
 */
export async function checkHeartbeatTimeout(): Promise<void> {
  const data = await chrome.storage.local.get([
    'notifeye_user',
    'notifeye_active_meeting',
    'notifeye_offline_queue',
  ]);

  const user = data.notifeye_user as UserDTO | undefined;
  const activeMeeting = (data.notifeye_active_meeting as ActiveMeetingState | undefined) ?? null;
  const offlineQueue = (data.notifeye_offline_queue as NormalizedEvent[] | undefined) ?? [];

  if (!user || !activeMeeting) return;

  const now = Date.now();
  if (shouldHeartbeatTimeout(activeMeeting.lastHeartbeatAt, now, HEARTBEAT_TIMEOUT_MS)) {
    // Heartbeats stopped longer than grace window -> emit meeting_left
    const leaveEvent: NormalizedEvent = {
      user_id: user.id,
      class_id: activeMeeting.classId,
      session_id: activeMeeting.sessionId,
      type: 'meeting_left',
      state: null,
      timestamp: new Date(activeMeeting.lastHeartbeatAt + 20_000).toISOString(),
      source: 'extension',
    };

    const newQueue = [...offlineQueue, leaveEvent].slice(-100);
    await chrome.storage.local.set({
      notifeye_active_meeting: null,
      notifeye_offline_queue: newQueue,
    });

    await flushEventQueue();
  }
}

/**
 * Periodic presence tick.
 * ONLY reports presence when current time is INSIDE a scheduled session window.
 * Outside any session window: sends nothing and marks status as "not_in_session".
 */
export async function onTick(): Promise<void> {
  try {
    await checkHeartbeatTimeout();

    const data = await chrome.storage.local.get([
      'notifeye_token',
      'notifeye_user',
      'notifeye_schedule',
      'notifeye_offline_queue',
    ]);

    const token = data.notifeye_token as string | undefined;
    const user = data.notifeye_user as UserDTO | undefined;
    const schedule = (data.notifeye_schedule as StudentScheduleItemDTO[] | undefined) ?? [];
    const offlineQueue = (data.notifeye_offline_queue as NormalizedEvent[] | undefined) ?? [];

    if (!token || !user) {
      await chrome.storage.local.set({
        notifeye_active_session: null,
        notifeye_current_status: 'not_in_session',
      });
      return;
    }

    const now = new Date();
    const nowMs = now.getTime();

    // Check if currently inside any scheduled session window
    const activeSession = schedule.find((s) => {
      const start = new Date(s.starts_at).getTime();
      const end = new Date(s.ends_at).getTime();
      return nowMs >= start && nowMs <= end;
    });

    // OUTSIDE ANY SESSION: Send NOTHING.
    if (!activeSession) {
      await chrome.storage.local.set({
        notifeye_active_session: null,
        notifeye_current_status: 'not_in_session',
      });
      return;
    }

    // INSIDE ACTIVE SESSION: Query browser idle state (threshold 300s / 5m)
    chrome.idle.queryState(300, async (idleState) => {
      const state: PresenceState =
        idleState === 'idle' ? 'idle' : idleState === 'locked' ? 'locked' : 'active';

      await chrome.storage.local.set({
        notifeye_active_session: activeSession,
        notifeye_current_status: state,
      });

      const presenceEvent: NormalizedEvent = {
        user_id: user.id,
        class_id: activeSession.class_id,
        session_id: activeSession.id,
        type: 'presence',
        state,
        timestamp: now.toISOString(),
        source: 'extension',
      };

      const batch = [...offlineQueue, presenceEvent];

      // Send batched events to POST /events
      try {
        const res = await fetch(`${API_BASE}/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ events: batch }),
        });

        if (res.ok) {
          // Successfully ingested: clear offline queue
          await chrome.storage.local.set({ notifeye_offline_queue: [] });
        } else {
          // Keep in queue for next tick (capped at 100)
          await chrome.storage.local.set({ notifeye_offline_queue: batch.slice(-100) });
        }
      } catch {
        // Network offline: retain in offline queue
        await chrome.storage.local.set({ notifeye_offline_queue: batch.slice(-100) });
      }
    });
  } catch (err) {
    console.error('[NotifEye SW] onTick error:', err);
  }
}

function initAlarms(): void {
  // Demo mode: 30 seconds (0.5m), Normal mode: 1 minute (1.0m)
  const tickPeriod = IS_DEMO ? 0.5 : 1.0;
  chrome.alarms.create(TICK_ALARM, { periodInMinutes: tickPeriod });
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 15.0 });
}

chrome.runtime.onInstalled.addListener(() => {
  initAlarms();
  refreshSchedule().then(() => onTick());
});

chrome.runtime.onStartup.addListener(() => {
  initAlarms();
  refreshSchedule().then(() => onTick());
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TICK_ALARM) {
    onTick();
  } else if (alarm.name === REFRESH_ALARM) {
    refreshSchedule();
  } else if (alarm.name.startsWith(REMINDER_ALARM_PREFIX)) {
    const sessionId = alarm.name.slice(REMINDER_ALARM_PREFIX.length);
    const data = await chrome.storage.local.get(['notifeye_schedule']);
    const schedule = (data.notifeye_schedule as StudentScheduleItemDTO[]) || [];
    const session = schedule.find((s) => s.id === sessionId);
    if (session) {
      chrome.notifications?.create(`reminder_${sessionId}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'NotifEye Class Reminder',
        message: `${session.class_name} starts in 10 minutes`,
      });
    }
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'MEETING_HEARTBEAT') {
    handleMeetingHeartbeat(msg.meetingId, msg.timestamp).then((res) => sendResponse(res));
    return true;
  }
  if (msg?.type === 'MEETING_PAGEHIDE') {
    handleMeetingPagehide(msg.meetingId, msg.timestamp).then((res) => sendResponse(res));
    return true;
  }
  if (msg?.type === 'REFRESH_SCHEDULE') {
    refreshSchedule().then((schedule) => sendResponse({ ok: true, schedule }));
    return true;
  }
  if (msg?.type === 'TICK_NOW') {
    onTick().then(() => sendResponse({ ok: true }));
    return true;
  }
});
