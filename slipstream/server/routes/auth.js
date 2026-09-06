import { Router } from 'express'
import { db, uid, now } from '../lib/db.js'
import {
  signToken, publicUser, requireAuth, hashPassword, checkPassword, findOrCreateUserByPhone,
} from '../lib/auth.js'
import { validatePhone, validateName, validateEmail, validatePassword } from '../../src/utils/validate.js'

export const authRoutes = Router()

// OTPs live in the `otps` table, not an in-memory Map: a serverless
// invocation shares no memory with the next one, so anything that must
// survive between the /send and /verify calls has to be durable. No SMS
// provider is wired up, so in development the code is returned in the
// response instead of being silently undeliverable.
const OTP_TTL_MS = 5 * 60 * 1000
const isProd = process.env.NODE_ENV === 'production'

authRoutes.post('/otp/send', async (req, res) => {
  const phone = String(req.body?.phone ?? '').trim()
  const error = validatePhone(phone)
  if (error) return res.status(400).json({ error, field: 'phone' })

  const code = String(Math.floor(100000 + Math.random() * 900000))
  await db.prepare(
    `INSERT INTO otps (phone, code, expires_at, attempts) VALUES (?, ?, ?, 0)
     ON CONFLICT (phone) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at, attempts = 0`,
  ).run(phone, code, Date.now() + OTP_TTL_MS)

  if (isProd && !process.env.SMS_PROVIDER_URL) {
    return res.status(503).json({
      error: 'SMS delivery is not configured. Add SMS_PROVIDER_URL to send real codes.',
    })
  }
  res.json({ sent: true, expiresInSec: OTP_TTL_MS / 1000, devCode: isProd ? undefined : code })
})

authRoutes.post('/otp/verify', async (req, res) => {
  const phone = String(req.body?.phone ?? '').trim()
  const code = String(req.body?.code ?? '').trim()
  const name = req.body?.name

  const phoneError = validatePhone(phone)
  if (phoneError) return res.status(400).json({ error: phoneError, field: 'phone' })

  const entry = await db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone)
  if (!entry) return res.status(400).json({ error: 'Request a new code', field: 'code' })
  if (Date.now() > Number(entry.expires_at)) {
    await db.prepare('DELETE FROM otps WHERE phone = ?').run(phone)
    return res.status(400).json({ error: 'That code expired — request a new one', field: 'code' })
  }
  if (entry.attempts >= 5) {
    await db.prepare('DELETE FROM otps WHERE phone = ?').run(phone)
    return res.status(429).json({ error: 'Too many attempts — request a new code', field: 'code' })
  }
  if (entry.code !== code) {
    await db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?').run(phone)
    return res.status(400).json({ error: 'That code is not right', field: 'code' })
  }

  // A brand-new number needs a name before an account can exist. The OTP row
  // is deliberately NOT deleted yet: this branch sends the client back for a
  // name and it must be able to re-verify with the same code.
  const existing = await db.prepare('SELECT * FROM users WHERE phone = ?').get(phone)
  if (!existing) {
    const nameError = validateName(name, { field: 'Name' })
    if (nameError) return res.status(400).json({ error: nameError, field: 'name', needsName: true })
  }

  await db.prepare('DELETE FROM otps WHERE phone = ?').run(phone)
  const user = await findOrCreateUserByPhone(phone, name)
  res.json({ token: signToken(user), user: publicUser(user) })
})

authRoutes.post('/register', async (req, res) => {
  const { name, email, password } = req.body ?? {}
  const errors = {}
  const nameError = validateName(name, { field: 'Name' })
  const emailError = validateEmail(email, { required: true })
  const passwordError = validatePassword(password)
  if (nameError) errors.name = nameError
  if (emailError) errors.email = emailError
  if (passwordError) errors.password = passwordError
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Check the form', errors })

  const normalized = String(email).trim().toLowerCase()
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalized)) {
    return res.status(409).json({ error: 'That email already has an account', field: 'email' })
  }

  const row = {
    id: uid('usr'),
    name: String(name).trim(),
    email: normalized,
    password_hash: hashPassword(password),
    avatar_color: '#e8562b',
    created_at: now(),
  }
  await db.prepare(
    `INSERT INTO users (id, name, email, password_hash, avatar_color, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.name, row.email, row.password_hash, row.avatar_color, row.created_at)

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(row.id)
  res.status(201).json({ token: signToken(user), user: publicUser(user) })
})

authRoutes.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  const normalized = String(email ?? '').trim().toLowerCase()
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(normalized)
  // Same message either way — never reveal which half was wrong.
  if (!user || !checkPassword(String(password ?? ''), user.password_hash)) {
    return res.status(401).json({ error: 'Email or password is incorrect' })
  }
  res.json({ token: signToken(user), user: publicUser(user) })
})

authRoutes.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})
