import { pool, closePool } from '../src/db';
import { hashPassword } from '../src/modules/auth/passwords';
import { generateClassCode } from '../src/modules/classes/service';
import { extractMeetingId } from '@notifeye/shared';

async function seed() {
  const profCredentials = {
    email: 'demo-prof@notifeye.local',
    password: 'demo-prof-password-123',
    name: 'Demo Professor',
  };

  const studentCredentials = [
    {
      email: 'demo-student1@notifeye.local',
      password: 'demo-student1-password-123',
      name: 'Demo Student One',
    },
    {
      email: 'demo-student2@notifeye.local',
      password: 'demo-student2-password-123',
      name: 'Demo Student Two',
    },
    {
      email: 'demo-student3@notifeye.local',
      password: 'demo-student3-password-123',
      name: 'Demo Student Three',
    },
  ];

  console.log('Seeding demo data...');

  // Helper to upsert user idempotently
  async function upsertUser(email: string, plainPass: string, name: string): Promise<string> {
    const passwordHash = await hashPassword(plainPass);
    const { rows: existing } = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = lower($1)`,
      [email],
    );

    if (existing.length > 0) {
      const id = existing[0]!.id;
      await pool.query(
        `UPDATE users
            SET password_hash = $1,
                name = $2,
                consent_at = COALESCE(consent_at, now()),
                consent_version = 'v1'
          WHERE id = $3`,
        [passwordHash, name, id],
      );
      return id;
    }

    const { rows: inserted } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, consent_at, consent_version)
       VALUES ($1, $2, $3, now(), 'v1')
       RETURNING id`,
      [email, passwordHash, name],
    );
    return inserted[0]!.id;
  }

  // 1. Professor
  const profId = await upsertUser(profCredentials.email, profCredentials.password, profCredentials.name);

  // 2. Students
  const studentIds: string[] = [];
  for (const s of studentCredentials) {
    const sId = await upsertUser(s.email, s.password, s.name);
    studentIds.push(sId);
  }

  // 3. Create or find "Demo Class"
  let classId: string;
  const { rows: existingClasses } = await pool.query<{ id: string }>(
    `SELECT id FROM classes WHERE owner_id = $1 AND name = $2`,
    [profId, 'Demo Class'],
  );

  if (existingClasses.length > 0) {
    classId = existingClasses[0]!.id;
  } else {
    const code = generateClassCode();
    const { rows: newClass } = await pool.query<{ id: string }>(
      `INSERT INTO classes (name, section, platform, class_code, owner_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      ['Demo Class', 'Section A', 'meet', code, profId],
    );
    classId = newClass[0]!.id;
  }

  // Ensure professor enrollment
  await pool.query(
    `INSERT INTO enrollments (user_id, class_id, role, status)
     VALUES ($1, $2, 'professor', 'approved')
     ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'approved'`,
    [profId, classId],
  );

  // 4. Enroll the 3 students with approved status
  for (const sId of studentIds) {
    await pool.query(
      `INSERT INTO enrollments (user_id, class_id, role, status, consent_at)
       VALUES ($1, $2, 'student', 'approved', now())
       ON CONFLICT (user_id, class_id) DO UPDATE
          SET status = 'approved',
              consent_at = COALESCE(enrollments.consent_at, now())`,
      [sId, classId],
    );
  }

  // 5. Create or update session (starts 1 min ago, ends in 1 hr, 3 min grace, Google Meet link)
  const now = Date.now();
  const startsAt = new Date(now - 60 * 1000);
  const endsAt = new Date(now + 60 * 60 * 1000);
  const meetingLink = 'https://meet.google.com/abc-defg-hij';
  const meetingId = extractMeetingId(meetingLink);

  const { rows: existingSessions } = await pool.query<{ id: string }>(
    `SELECT id FROM class_sessions WHERE class_id = $1 AND meeting_link = $2`,
    [classId, meetingLink],
  );

  if (existingSessions.length > 0) {
    await pool.query(
      `UPDATE class_sessions
          SET starts_at = $1,
              ends_at = $2,
              grace_minutes = 3,
              meeting_id = $3
        WHERE id = $4`,
      [startsAt, endsAt, meetingId, existingSessions[0]!.id],
    );
  } else {
    await pool.query(
      `INSERT INTO class_sessions (class_id, starts_at, ends_at, meeting_link, meeting_id, grace_minutes)
       VALUES ($1, $2, $3, $4, $5, 3)`,
      [classId, startsAt, endsAt, meetingLink, meetingId],
    );
  }

  console.log('\n--- Demo Credentials ---');
  console.log(`Professor:`);
  console.log(`  Email:    ${profCredentials.email}`);
  console.log(`  Password: ${profCredentials.password}`);
  console.log(`\nStudents:`);
  for (const s of studentCredentials) {
    console.log(`  Email:    ${s.email}`);
    console.log(`  Password: ${s.password}`);
  }
  console.log('------------------------\n');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });
