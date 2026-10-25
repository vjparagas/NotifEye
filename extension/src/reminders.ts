import {
  computeReminderTime,
  shouldScheduleReminder,
  planSessionReminders,
  REMINDER_ALARM_PREFIX,
  REMINDER_LEAD_TIME_MINUTES,
  type UpcomingSessionForReminder,
  type ReminderPlan,
} from '@notifeye/shared';

export {
  computeReminderTime,
  shouldScheduleReminder,
  planSessionReminders,
  REMINDER_ALARM_PREFIX,
  REMINDER_LEAD_TIME_MINUTES,
  type UpcomingSessionForReminder,
  type ReminderPlan,
};

/**
 * Schedules alarms for all upcoming sessions in schedule, 10 min prior to session start.
 * Clears old reminder alarms first to avoid duplicate notifications and reschedule cleanly.
 */
export async function scheduleReminders(
  schedule: UpcomingSessionForReminder[],
  now: number = Date.now(),
): Promise<string[]> {
  if (typeof chrome === 'undefined' || !chrome.alarms) {
    return [];
  }

  // 1. Clear existing reminder alarms
  const existing = await chrome.alarms.getAll();
  for (const alarm of existing) {
    if (alarm.name.startsWith(REMINDER_ALARM_PREFIX)) {
      await chrome.alarms.clear(alarm.name);
    }
  }

  // 2. Plan reminders
  const plan = planSessionReminders(schedule, now);
  const scheduled: string[] = [];

  for (const item of plan) {
    if (item.scheduled) {
      chrome.alarms.create(item.alarmName, { when: item.reminderTime.getTime() });
      scheduled.push(item.alarmName);
    }
  }

  return scheduled;
}
