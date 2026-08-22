import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DB_PATH = process.env.SLIPSTREAM_DB || resolve(process.cwd(), 'data/slipstream.db')
mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Schema is declarative and idempotent — safe to run on every boot. Money is
// stored in paise (integer) so splitting never accumulates float drift.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT,
  avatar_color  TEXT,
  blood_group   TEXT,
  medical_notes TEXT,
  emergency_name   TEXT,
  emergency_phone  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rides (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  origin       TEXT,
  destination  TEXT,
  starts_at    INTEGER,
  duration_hrs REAL,
  visibility   TEXT NOT NULL DEFAULT 'private',
  status       TEXT NOT NULL DEFAULT 'planned',
  join_code    TEXT UNIQUE NOT NULL,
  leader_id    TEXT NOT NULL REFERENCES users(id),
  created_by   TEXT NOT NULL REFERENCES users(id),
  distance_km  REAL DEFAULT 0,
  rating       INTEGER,
  notes        TEXT,
  fuel_cost    INTEGER,
  created_at   INTEGER NOT NULL,
  ended_at     INTEGER
);

CREATE TABLE IF NOT EXISTS ride_members (
  ride_id   TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'rider',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (ride_id, user_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  ride_id     TEXT REFERENCES rides(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  settled_at  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other',
  amount      INTEGER NOT NULL,
  paid_by     TEXT NOT NULL REFERENCES users(id),
  created_by  TEXT NOT NULL REFERENCES users(id),
  spent_at    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER
);

-- One row per participant per expense. Storing the resolved share (rather than
-- recomputing from a split rule) keeps historical splits stable when a group's
-- membership later changes.
CREATE TABLE IF NOT EXISTS expense_shares (
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share      INTEGER NOT NULL,
  PRIMARY KEY (expense_id, user_id)
);

CREATE TABLE IF NOT EXISTS settlements (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user  TEXT NOT NULL REFERENCES users(id),
  to_user    TEXT NOT NULL REFERENCES users(id),
  amount     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  ride_id    TEXT REFERENCES rides(id) ON DELETE CASCADE,
  group_id   TEXT REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname      TEXT NOT NULL,
  brand         TEXT,
  model         TEXT,
  reg_no        TEXT,
  odometer_km   INTEGER,
  insurance_due INTEGER,
  puc_due       INTEGER,
  service_due   INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'system',
  title      TEXT NOT NULL,
  body       TEXT,
  read_at    INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ride_members_user ON ride_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_ride ON messages(ride_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
`)

export function uid(prefix = '') {
  const s = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  return prefix ? `${prefix}_${s}` : s
}

export const now = () => Date.now()
