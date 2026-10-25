import cron, { type ScheduledTask } from 'node-cron';
import { pool } from '../../db';
import { evaluateSessionAttendance } from '../attendance/service';

export async function runAttendanceSweep(now: Date = new Date()): Promise<{ evaluatedSessions: number }> {
  const nowIso = now.toISOString();

  // Find all sessions currently ongoing OR sessions that have ended but are not yet finalized
  const { rows: sessions } = await pool.query<{ id: string }>(
    `SELECT id FROM class_sessions
      WHERE (starts_at <= $1 AND ends_at >= $1)
         OR (ends_at <= $1 AND finalized_at IS NULL)`,
    [nowIso],
  );

  for (const s of sessions) {
    try {
      await evaluateSessionAttendance(s.id, pool, now);
    } catch (err) {
      console.error(`[Scheduler] Error evaluating attendance for session ${s.id}:`, err);
    }
  }

  return { evaluatedSessions: sessions.length };
}

let cronTask: ScheduledTask | null = null;

export function startScheduler(): { stop: () => void } {
  if (cronTask) {
    cronTask.stop();
  }

  cronTask = cron.schedule('* * * * *', async () => {
    try {
      await runAttendanceSweep(new Date());
    } catch (err) {
      console.error('[Scheduler] Cron sweep failed:', err);
    }
  });

  return {
    stop: () => {
      cronTask?.stop();
      cronTask = null;
    },
  };
}
