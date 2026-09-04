import pg from 'pg'

const { Pool } = pg

// A single pool per process. On Vercel each serverless invocation may reuse a
// warm container, so this is created once at module load and reused across
// calls within that container rather than per-request.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon/Vercel Postgres require TLS; rejectUnauthorized:false matches their
  // documented connection recipe for serverless clients.
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: process.env.VERCEL ? 1 : 10, // one connection per serverless instance is the safe default
})

/**
 * A thin shim over `pg` shaped like better-sqlite3's synchronous API
 * (`db.prepare(sql).get/all/run(...args)`), so route files keep the same
 * calling convention and only need `await` added at each call site — the SQL
 * itself is untouched except for `?` placeholders, rewritten to Postgres's
 * `$1, $2, ...` here rather than in every query string.
 */
function toPg(sql) {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

class Statement {
  constructor(sql) {
    this.sql = toPg(sql)
  }
  async get(...args) {
    const { rows } = await pool.query(this.sql, args)
    return rows[0]
  }
  async all(...args) {
    const { rows } = await pool.query(this.sql, args)
    return rows
  }
  async run(...args) {
    const res = await pool.query(this.sql, args)
    return { changes: res.rowCount }
  }
}

export const db = {
  prepare(sql) {
    return new Statement(sql)
  },
  async exec(sql) {
    await pool.query(sql)
  },
  /**
   * better-sqlite3's `db.transaction(fn)` returns a synchronous function that
   * runs `fn` atomically. Postgres transactions are inherently async, so this
   * returns an async function instead — every call site does
   * `await db.transaction(fn)(...)`, one extra `await`, same shape otherwise.
   */
  transaction(fn) {
    return async (...args) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const scoped = {
          prepare(sql) {
            const stmt = new Statement(sql)
            return {
              get: (...a) => client.query(stmt.sql, a).then((r) => r.rows[0]),
              all: (...a) => client.query(stmt.sql, a).then((r) => r.rows),
              run: (...a) => client.query(stmt.sql, a).then((r) => ({ changes: r.rowCount })),
            }
          },
        }
        const result = await fn(scoped, ...args)
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    }
  },
}

export function uid(prefix = '') {
  const s = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  return prefix ? `${prefix}_${s}` : s
}

export const now = () => Date.now()

/** Schema is declarative and idempotent — safe to run on every cold start.
 *  Money is stored in paise (integer/bigint) so splitting never accumulates
 *  float drift. Timestamps are epoch-ms bigints to match the app's existing
 *  `Date.now()`-based format used throughout the client. */
export async function migrate() {
  await pool.query(`
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
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS rides (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  origin       TEXT,
  destination  TEXT,
  starts_at    BIGINT,
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
  memory_limit INTEGER NOT NULL DEFAULT 10,
  created_at   BIGINT NOT NULL,
  ended_at     BIGINT
);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS memory_limit INTEGER NOT NULL DEFAULT 10;

CREATE TABLE IF NOT EXISTS ride_members (
  ride_id   TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'rider',
  joined_at BIGINT NOT NULL,
  seq       SERIAL,
  lat                 DOUBLE PRECISION,
  lng                 DOUBLE PRECISION,
  location_updated_at BIGINT,
  PRIMARY KEY (ride_id, user_id)
);

-- Added after the original table shipped, so existing deployments need the
-- columns backfilled onto whatever ride_members already has.
ALTER TABLE ride_members ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE ride_members ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE ride_members ADD COLUMN IF NOT EXISTS location_updated_at BIGINT;

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  ride_id     TEXT REFERENCES rides(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  settled_at  BIGINT,
  created_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at BIGINT NOT NULL,
  seq       SERIAL,
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
  spent_at    BIGINT NOT NULL,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT
);

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
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  ride_id    TEXT REFERENCES rides(id) ON DELETE CASCADE,
  group_id   TEXT REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

-- The leader writes one shared list of items; each rider ticks their own copy,
-- so "who is ready" is a count of that rider's checks, not a shared state.
CREATE TABLE IF NOT EXISTS checklist_items (
  id         TEXT PRIMARY KEY,
  ride_id    TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  seq        SERIAL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist_checks (
  item_id    TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_at BIGINT NOT NULL,
  PRIMARY KEY (item_id, user_id)
);

-- Photos/clips shared to a single ride, visible only to that ride's members.
CREATE TABLE IF NOT EXISTS memories (
  id         TEXT PRIMARY KEY,
  ride_id    TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_url  TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'photo',
  caption    TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_likes (
  memory_id  TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (memory_id, user_id)
);

-- Breadcrumbs of where the ride actually went, so the end-of-ride share card
-- can draw the real route instead of a decorative squiggle. Points are only
-- appended when a rider has actually moved (see MIN_TRACK_METERS), which keeps
-- a parked bike from filling the table.
CREATE TABLE IF NOT EXISTS ride_track (
  id         SERIAL PRIMARY KEY,
  ride_id    TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname      TEXT NOT NULL,
  brand         TEXT,
  model         TEXT,
  reg_no        TEXT,
  odometer_km   INTEGER,
  insurance_due BIGINT,
  puc_due       BIGINT,
  service_due   BIGINT,
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'system',
  title      TEXT NOT NULL,
  body       TEXT,
  read_at    BIGINT,
  created_at BIGINT NOT NULL
);

-- OTPs used to live in an in-memory Map. Serverless has no shared memory
-- across invocations, so they now live here with a real expiry column.
CREATE TABLE IF NOT EXISTS otps (
  phone      TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ride_members_user ON ride_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_ride ON memories(ride_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_likes_memory ON memory_likes(memory_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_ride ON checklist_items(ride_id, seq);
CREATE INDEX IF NOT EXISTS idx_checklist_checks_item ON checklist_checks(item_id);
CREATE INDEX IF NOT EXISTS idx_ride_track_ride ON ride_track(ride_id, created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_ride ON messages(ride_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
`)
}
