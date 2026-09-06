import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { db, uid, now } from './db.js'

// A dev fallback keeps `npm run dev` zero-config, but refusing to boot in
// production without a real secret means we can never ship signing tokens
// with a publicly-known key.
const SECRET = process.env.JWT_SECRET || 'slipstream-dev-secret-change-me'
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production')
}

const TOKEN_TTL = '30d'
const AVATAR_COLORS = ['#e8562b', '#d4537e', '#378add', '#1d9e75', '#c99a2e', '#7b61ff', '#2aa9a0']

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10)
export const checkPassword = (pw, hash) => (hash ? bcrypt.compareSync(pw, hash) : false)

export function signToken(user) {
  return jwt.sign({ sub: user.id }, SECRET, { expiresIn: TOKEN_TTL })
}

export async function findOrCreateUserByPhone(phone, name) {
  const existing = await db.prepare('SELECT * FROM users WHERE phone = ?').get(phone)
  if (existing) return existing
  const user = {
    id: uid('usr'),
    name: name?.trim() || 'Rider',
    phone,
    avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    created_at: now(),
  }
  await db.prepare(
    `INSERT INTO users (id, name, phone, avatar_color, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(user.id, user.name, user.phone, user.avatar_color, user.created_at)
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
}

/** Strips password_hash and other private columns before a user crosses the wire. */
export function publicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url,
    bloodGroup: row.blood_group,
    medicalNotes: row.medical_notes,
    emergencyContact: row.emergency_name
      ? { name: row.emergency_name, phone: row.emergency_phone }
      : null,
    createdAt: row.created_at,
  }
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Sign in to continue' })
  try {
    const { sub } = jwt.verify(token, SECRET)
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(sub)
    if (!user) return res.status(401).json({ error: 'Session no longer valid' })
    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: 'Session expired — sign in again' })
  }
}
