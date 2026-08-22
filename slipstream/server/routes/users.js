import { Router } from 'express'
import { db, uid, now } from '../lib/db.js'
import { requireAuth, publicUser } from '../lib/auth.js'
import { validatePhone, validateEmail, validateName, PHONE_RE } from '../../src/utils/validate.js'

export const userRoutes = Router()
userRoutes.use(requireAuth)

/**
 * Rider lookup for invites. Searching by full phone number is exact; searching
 * by name is a prefix match. Results are deliberately thin — a phone search
 * confirms only that an account exists, and never exposes anyone's email.
 */
userRoutes.get('/search', (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (q.length < 3) return res.json({ results: [] })

  const digits = q.replace(/\D/g, '')
  let rows = []
  if (PHONE_RE.test(digits)) {
    rows = db.prepare('SELECT * FROM users WHERE phone = ? LIMIT 1').all(digits)
  } else {
    rows = db
      .prepare('SELECT * FROM users WHERE name LIKE ? AND id != ? ORDER BY name LIMIT 8')
      .all(`${q}%`, req.user.id)
  }
  res.json({
    results: rows.map((r) => ({
      id: r.id,
      name: r.name,
      avatarColor: r.avatar_color,
      phoneHint: r.phone ? `••••${r.phone.slice(-4)}` : null,
      isYou: r.id === req.user.id,
    })),
  })
})

/**
 * Creates a placeholder account for someone not on Slipstream yet, so they can
 * be added to a group and settle up before they ever install the app. When
 * they later verify that number, findOrCreateUserByPhone returns this same row.
 */
userRoutes.post('/invite', (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const phone = String(req.body?.phone ?? '').replace(/\D/g, '')

  const nameError = validateName(name, { field: 'Name' })
  if (nameError) return res.status(400).json({ error: nameError, field: 'name' })
  const phoneError = validatePhone(phone)
  if (phoneError) return res.status(400).json({ error: phoneError, field: 'phone' })

  const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone)
  if (existing) return res.json({ user: publicUser(existing), created: false })

  const row = {
    id: uid('usr'),
    name,
    phone,
    avatar_color: '#378add',
    created_at: now(),
  }
  db.prepare(
    `INSERT INTO users (id, name, phone, avatar_color, created_at)
     VALUES (@id, @name, @phone, @avatar_color, @created_at)`,
  ).run(row)
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id)), created: true })
})

userRoutes.patch('/me', (req, res) => {
  const b = req.body ?? {}
  const errors = {}

  if (b.name !== undefined) {
    const e = validateName(b.name, { field: 'Name' })
    if (e) errors.name = e
  }
  if (b.email !== undefined && String(b.email).trim() !== '') {
    const e = validateEmail(b.email)
    if (e) errors.email = e
    else {
      const taken = db
        .prepare('SELECT 1 FROM users WHERE email = ? AND id != ?')
        .get(String(b.email).trim().toLowerCase(), req.user.id)
      if (taken) errors.email = 'That email is already in use'
    }
  }
  if (b.emergencyPhone !== undefined && String(b.emergencyPhone).trim() !== '') {
    const e = validatePhone(String(b.emergencyPhone).replace(/\D/g, ''))
    if (e) errors.emergencyPhone = e
  }
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Check the form', errors })

  const next = {
    name: b.name !== undefined ? String(b.name).trim() : req.user.name,
    email: b.email !== undefined
      ? (String(b.email).trim() ? String(b.email).trim().toLowerCase() : null)
      : req.user.email,
    blood_group: b.bloodGroup !== undefined ? (b.bloodGroup || null) : req.user.blood_group,
    medical_notes: b.medicalNotes !== undefined ? (b.medicalNotes || null) : req.user.medical_notes,
    emergency_name: b.emergencyName !== undefined ? (b.emergencyName || null) : req.user.emergency_name,
    emergency_phone: b.emergencyPhone !== undefined
      ? (String(b.emergencyPhone).replace(/\D/g, '') || null)
      : req.user.emergency_phone,
    id: req.user.id,
  }

  db.prepare(
    `UPDATE users SET name=@name, email=@email, blood_group=@blood_group,
       medical_notes=@medical_notes, emergency_name=@emergency_name,
       emergency_phone=@emergency_phone WHERE id=@id`,
  ).run(next)

  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) })
})
