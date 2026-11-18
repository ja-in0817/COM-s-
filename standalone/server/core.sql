CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('participant','moderator','admin')),
  age INTEGER,
  age_group TEXT NOT NULL CHECK(age_group IN ('13-15','16-18','staff')),
  district TEXT NOT NULL DEFAULT '',
  interests TEXT NOT NULL DEFAULT '[]',
  availability TEXT NOT NULL DEFAULT '',
  participation_mode TEXT NOT NULL DEFAULT 'text',
  intensity TEXT NOT NULL DEFAULT 'low',
  created_at INTEGER NOT NULL,
  disabled_at INTEGER,
  consent_version TEXT NOT NULL,
  consent_at INTEGER NOT NULL,
  CHECK((role = 'participant' AND age BETWEEN 13 AND 18 AND
    ((age <= 15 AND age_group = '13-15') OR (age >= 16 AND age_group = '16-18')))
    OR (role IN ('moderator','admin') AND age IS NULL AND age_group = 'staff'))
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  csrf_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  age INTEGER NOT NULL CHECK(age BETWEEN 13 AND 18),
  age_group TEXT NOT NULL CHECK(age_group IN ('13-15','16-18')),
  guardian_verified INTEGER NOT NULL DEFAULT 0,
  age_verified INTEGER NOT NULL CHECK(age_verified = 1),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT REFERENCES users(id),
  revoked_at INTEGER,
  CHECK(age <> 13 OR guardian_verified = 1)
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_log_created ON audit_log(created_at);
