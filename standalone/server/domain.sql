CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL,
  age_group TEXT NOT NULL CHECK(age_group IN ('13-15','16-18')),
  mode TEXT NOT NULL DEFAULT 'text' CHECK(mode='text'),
  intensity TEXT NOT NULL CHECK(intensity IN ('low','medium','high')),
  schedule TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL CHECK(capacity IN (3,4)),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  archived_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS groups_age_status ON groups(age_group,status,created_at);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('active','paused','left','removed')),
  joined_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(group_id,user_id)
);
CREATE INDEX IF NOT EXISTS group_members_user ON group_members(user_id,status);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  client_id TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
  created_at INTEGER NOT NULL,
  UNIQUE(user_id,client_id)
);
CREATE INDEX IF NOT EXISTS messages_group_time ON messages(group_id,created_at,id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK(duration_minutes IN (15,30,45,60)),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_group_time ON sessions(group_id,starts_at);
CREATE TABLE IF NOT EXISTS attendance (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  checked_in_at INTEGER NOT NULL,
  PRIMARY KEY(session_id,user_id)
);
CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  comfort INTEGER NOT NULL CHECK(comfort BETWEEN 1 AND 5),
  return_intent INTEGER NOT NULL CHECK(return_intent BETWEEN 1 AND 5),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS checkins_user ON checkins(user_id,created_at);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id),
  target_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  CHECK(blocker_id<>target_id),
  PRIMARY KEY(blocker_id,target_id)
);
CREATE INDEX IF NOT EXISTS blocks_target ON blocks(target_id,blocker_id);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  group_id TEXT NOT NULL REFERENCES groups(id),
  message_id TEXT REFERENCES messages(id),
  target_id TEXT REFERENCES users(id),
  category TEXT NOT NULL,
  reason TEXT NOT NULL,
  message_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','actioned','dismissed','restored')),
  decision TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status,created_at);
CREATE TABLE IF NOT EXISTS report_reviews (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK(decision IN ('dismiss','hide_message','restrict_user','restore')),
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_restrictions (
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  report_id TEXT NOT NULL REFERENCES reports(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL,
  restored_at INTEGER,
  PRIMARY KEY(group_id,user_id,report_id)
);
CREATE INDEX IF NOT EXISTS restrictions_user ON group_restrictions(group_id,user_id,active);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  verification_status TEXT NOT NULL DEFAULT 'directory_only' CHECK(verification_status='directory_only'),
  min_age INTEGER NOT NULL,
  max_age INTEGER NOT NULL,
  description TEXT NOT NULL,
  verified_at INTEGER
);
INSERT OR IGNORE INTO organizations(id,name,region,phone,website,source_url,verification_status,min_age,max_age,description,verified_at)
VALUES ('a0b53023-8ae9-4d0a-b2de-927cbbe6b18b','청소년1388','전국','1388','https://www.1388.go.kr/','https://www.1388.go.kr/','directory_only',9,24,'청소년 상담과 지역 지원기관을 찾는 공식 안내입니다. 이 플랫폼의 협약기관이 아니며, 상담 이용과 접수는 해당 기관에 직접 확인해야 합니다.',NULL);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  status TEXT NOT NULL DEFAULT 'awaiting_connection' CHECK(status IN ('awaiting_connection','cancelled')),
  contact TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  consent_at INTEGER NOT NULL,
  consent_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER
);
CREATE INDEX IF NOT EXISTS referrals_user ON referrals(user_id,created_at);
