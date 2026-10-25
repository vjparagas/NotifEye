export const REMINDER_LEAD_TIME_MINUTES = 10;
export const REMINDER_LEAD_TIME_MS = REMINDER_LEAD_TIME_MINUTES * 60 * 1000;
export const REMINDER_ALARM_PREFIX = 'notifeye_reminder_';

export interface UpcomingSessionForReminder {
  id: string;
  class_name: string;
  starts_at: string;
  ends_at: string;
}

export interface ReminderPlan {
  sessionId: string;
  className: string;
  alarmName: string;
  reminderTime: Date;
  scheduled: boolean;
  message: string;
}

/**
 * Computes the exact reminder Date (10 minutes prior to session start).
 */
export function computeReminderTime(
  startsAt: string | Date | number,
  leadMinutes = REMINDER_LEAD_TIME_MINUTES,
): Date {
  const startMs =
    typeof startsAt === 'number'
      ? startsAt
      : startsAt instanceof Date
        ? startsAt.getTime()
        : new Date(startsAt).getTime();
  return new Date(startMs - leadMinutes * 60 * 1000);
}

/**
 * Evaluates whether a session should have an alarm scheduled based on current time.
 * Returns true only if the reminder time is strictly in the future.
 */
export function shouldScheduleReminder(
  startsAt: string | Date | number,
  now: Date | number = new Date(),
  leadMinutes = REMINDER_LEAD_TIME_MINUTES,
): boolean {
  const reminderTime = computeReminderTime(startsAt, leadMinutes);
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return reminderTime.getTime() > nowMs;
}

/**
 * Plans reminders for a list of scheduled sessions against a given clock.
 * Pure function: takes schedule and `now`, returns plan without side effects.
 */
export function planSessionReminders(
  sessions: UpcomingSessionForReminder[],
  now: Date | number = new Date(),
  leadMinutes = REMINDER_LEAD_TIME_MINUTES,
): ReminderPlan[] {
  const nowMs = typeof now === 'number' ? now : now.getTime();

  return sessions.map((s) => {
    const reminderTime = computeReminderTime(s.starts_at, leadMinutes);
    const scheduled = reminderTime.getTime() > nowMs;
    return {
      sessionId: s.id,
      className: s.class_name,
      alarmName: `${REMINDER_ALARM_PREFIX}${s.id}`,
      reminderTime,
      scheduled,
      message: `${s.class_name} starts in 10 minutes`,
    };
  });
}
