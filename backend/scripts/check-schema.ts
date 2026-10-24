/**
 * Verifies the migrated database matches what the code expects.
 * Usage: npm run db:check   (exit code 1 on any mismatch)
 */
import { pool, closePool } from '../src/db';

const EXPECTED: Record<string, string[]> = {
  users: ['id', 'email', 'password_hash', 'google_sub', 'name', 'consent_at', 'created_at'],
  classes: ['id', 'name', 'section', 'platform', 'class_code', 'owner_id'],
  enrollments: ['id', 'user_id', 'class_id', 'role', 'status', 'consent_at'],
  class_sessions: ['id', 'class_id', 'starts_at', 'ends_at', 'meeting_link', 'grace_minutes'],
  attendance_records: ['id', 'session_id', 'user_id', 'joined_at', 'left_at', 'status', 'source', 'overridden_by'],
  attendance_audit: ['id', 'attendance_id', 'actor_id', 'old_status', 'new_status'],
  activity_events: ['id', 'user_id', 'class_id', 'session_id', 'type', 'state', 'timestamp', 'source'],
  extension_installs: ['id', 'user_id', 'install_id', 'last_seen'],
  alerts: ['id', 'class_id', 'session_id', 'user_id', 'kind', 'message'],
  alert_rules: ['id', 'class_id', 'kind', 'enabled', 'threshold', 'channels'],
  import_aliases: ['id', 'class_id', 'alias', 'user_id'],
};

async function main(): Promise<void> {
  const { rows } = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const actual = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!actual.has(r.table_name)) actual.set(r.table_name, new Set());
    actual.get(r.table_name)!.add(r.column_name);
  }

  const problems: string[] = [];
  for (const [table, cols] of Object.entries(EXPECTED)) {
    const have = actual.get(table);
    if (!have) {
      problems.push(`missing table: ${table}`);
      continue;
    }
    for (const c of cols) if (!have.has(c)) problems.push(`missing column: ${table}.${c}`);
  }

  if (problems.length) {
    console.error('Schema check FAILED:\n' + problems.map((p) => '  - ' + p).join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Schema check OK: ${Object.keys(EXPECTED).length} tables present with expected columns.`);
  }
}

main()
  .catch((e) => {
    console.error('Schema check error:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closePool);
