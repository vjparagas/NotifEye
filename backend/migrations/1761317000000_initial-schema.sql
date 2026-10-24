-- Up Migration
-- NotifEye initial schema. All timestamps are timestamptz (stored UTC).
-- Roles live on `enrollments` (per class), never on `users`, so one account can be a
-- professor in one class and a student in another.

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  password_hash  text,                         -- bcrypt; NULL for Google-only accounts
  google_sub     text UNIQUE,                  -- Google account id; NULL for password accounts
  name           text NOT NULL,
  consent_at     timestamptz,                  -- sign-in consent timestamp (privacy requirement)
  consent_version text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_has_credential CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE classes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  section             text,
  platform            text NOT NULL CHECK (platform IN ('zoom', 'meet')),  -- no other platforms supported
  class_code          text NOT NULL UNIQUE,
  owner_id            uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  discord_webhook_url text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enrollments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id   uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('professor', 'student')),
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'removed')),
  consent_at timestamptz,                      -- consent given when joining this class
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, class_id)
);
CREATE INDEX enrollments_class_idx ON enrollments (class_id, role, status);

CREATE TABLE class_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id        uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  meeting_link    text NOT NULL,
  meeting_id      text,                        -- normalized meeting ID parsed from meeting_link
  grace_minutes   integer NOT NULL DEFAULT 10 CHECK (grace_minutes >= 0),
  summary_sent_at timestamptz,                 -- set once the end-of-session summary email is sent
  finalized_at    timestamptz,                 -- set once end-of-session attendance/alerts have run
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_sessions_window CHECK (ends_at > starts_at)
);
CREATE INDEX class_sessions_class_idx ON class_sessions (class_id, starts_at);
CREATE INDEX class_sessions_window_idx ON class_sessions (starts_at, ends_at);

CREATE TABLE attendance_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at     timestamptz,                   -- first join time
  left_at       timestamptz,
  status        text NOT NULL CHECK (status IN ('present', 'late', 'absent')),
  source        text NOT NULL CHECK (source IN ('extension', 'zoom_api', 'meet_api', 'csv', 'manual')),
  overridden_by uuid REFERENCES users(id) ON DELETE SET NULL,
  overridden_at timestamptz,
  conflict      jsonb,                         -- populated when sources disagree; professor decides
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX attendance_user_idx ON attendance_records (user_id);

-- Every manual override / automatic status change is logged here.
CREATE TABLE attendance_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  actor_id      uuid REFERENCES users(id) ON DELETE SET NULL,   -- NULL = system (e.g. late join after absent)
  old_status    text,
  new_status    text NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_audit_record_idx ON attendance_audit (attendance_id, created_at);

-- Only idle state and meeting join/leave are ever stored here: no page content, no URLs, no browsing data.
CREATE TABLE activity_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_id  uuid REFERENCES class_sessions(id) ON DELETE SET NULL,
  type        text NOT NULL CHECK (type IN ('meeting_joined', 'meeting_left', 'presence')),
  state       text CHECK (state IN ('active', 'idle', 'locked')),
  timestamp   timestamptz NOT NULL,            -- original device time (offline queue keeps it)
  source      text NOT NULL CHECK (source IN ('extension', 'zoom_api', 'meet_api', 'csv')),
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_events_presence_has_state CHECK (type <> 'presence' OR state IS NOT NULL)
);
-- Dedupes re-sent offline batches.
CREATE UNIQUE INDEX activity_events_dedupe_idx ON activity_events (user_id, class_id, type, timestamp, source);
CREATE INDEX activity_events_class_time_idx ON activity_events (class_id, timestamp DESC);
CREATE INDEX activity_events_user_time_idx ON activity_events (user_id, timestamp DESC);
CREATE INDEX activity_events_timestamp_idx ON activity_events (timestamp);   -- 180-day retention sweep

CREATE TABLE extension_installs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  install_id text NOT NULL,
  browser    text,
  version    text,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, install_id)
);

CREATE TABLE alert_rules (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id  uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  kind      text NOT NULL CHECK (kind IN
              ('absent', 'late', 'idle', 'repeated_absence', 'left_early', 'class_reminder')),
  enabled   boolean NOT NULL DEFAULT true,
  threshold integer,                           -- minutes (idle, left_early, reminder) or sessions (repeated_absence)
  channels  text[] NOT NULL DEFAULT ARRAY['dashboard']::text[]
            CHECK (channels <@ ARRAY['email', 'dashboard', 'discord']::text[]),
  UNIQUE (class_id, kind)
);

CREATE TABLE alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_id    uuid REFERENCES class_sessions(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,   -- the student the alert is about
  kind          text NOT NULL,
  message       text NOT NULL,
  channels_sent text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz
);
-- One alert per (session, student, kind): the engine runs every minute and must not re-fire.
CREATE UNIQUE INDEX alerts_dedupe_idx ON alerts (session_id, user_id, kind) WHERE session_id IS NOT NULL;
CREATE INDEX alerts_class_time_idx ON alerts (class_id, created_at DESC);

-- Maps names/emails found in imported CSV files to enrolled users.
CREATE TABLE import_aliases (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  alias      text NOT NULL,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX import_aliases_class_alias_idx ON import_aliases (class_id, lower(alias));

-- Down Migration
DROP TABLE IF EXISTS import_aliases;
DROP TABLE IF EXISTS alerts;
DROP TABLE IF EXISTS alert_rules;
DROP TABLE IF EXISTS extension_installs;
DROP TABLE IF EXISTS activity_events;
DROP TABLE IF EXISTS attendance_audit;
DROP TABLE IF EXISTS attendance_records;
DROP TABLE IF EXISTS class_sessions;
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS classes;
DROP TABLE IF EXISTS users;
