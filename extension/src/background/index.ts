import type {
  NormalizedEvent,
  PresenceState,
  StudentScheduleItemDTO,
  UserDTO,
} from '@notifeye/shared';

const API_BASE = typeof __API_URL__ !== 'undefined' ? __API_URL__ : 'http://localhost:4000';
const IS_DEMO = typeof __DEMO_MODE__ !== 'undefined' ? __DEMO_MODE__ : false;

const TICK_ALARM = 'notifeye_tick';
const REFRESH_ALARM = 'notifeye_schedule_refresh';

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
      return schedule;
    }
  } catch (err) {
    console.warn('[NotifEye SW] Schedule refresh failed:', err);
  }
  return [];
}

/**
 * Periodic presence tick.
 * ONLY reports presence when current time is INSIDE a scheduled session window.
 * Outside any session window: sends nothing and marks status as "not_in_session".
 */
export async function onTick(): Promise<void> {
  try {
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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) {
    onTick();
  } else if (alarm.name === REFRESH_ALARM) {
    refreshSchedule();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'REFRESH_SCHEDULE') {
    refreshSchedule().then((schedule) => sendResponse({ ok: true, schedule }));
    return true;
  }
  if (msg?.type === 'TICK_NOW') {
    onTick().then(() => sendResponse({ ok: true }));
    return true;
  }
});
