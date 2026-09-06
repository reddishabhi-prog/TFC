import { Router } from 'express'
import { db, uid, now } from '../lib/db.js'
import { requireAuth } from '../lib/auth.js'
import { validateName, validateOdometer, validateRegNo } from '../../src/utils/validate.js'

/* ------------------------------------------------------------------ chat -- */

export const chatRoutes = Router()
chatRoutes.use(requireAuth)

const MAX_MESSAGE = 2000

/** A thread is a ride the viewer rides in, or a standalone group they belong to. */
async function canSeeThread(userId, { rideId, groupId }) {
  if (rideId) return !!(await db.prepare('SELECT 1 FROM ride_members WHERE ride_id = ? AND user_id = ?').get(rideId, userId))
  if (groupId) return !!(await db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId))
  return false
}

chatRoutes.get('/threads', async (req, res) => {
  const rides = await db
    .prepare(
      `SELECT r.id, r.name, r.status FROM rides r
         JOIN ride_members rm ON rm.ride_id = r.id
        WHERE rm.user_id = ? ORDER BY r.created_at DESC`,
    )
    .all(req.user.id)

  const threads = await Promise.all(rides.map(async (r) => {
    const last = await db
      .prepare(
        `SELECT m.body, m.created_at, u.name FROM messages m JOIN users u ON u.id = m.user_id
          WHERE m.ride_id = ? ORDER BY m.created_at DESC LIMIT 1`,
      )
      .get(r.id)
    return {
      id: r.id,
      kind: 'ride',
      name: r.name,
      status: r.status,
      lastMessage: last ? { body: last.body, author: last.name, at: Number(last.created_at) } : null,
      updatedAt: last ? Number(last.created_at) : 0,
    }
  }))

  threads.sort((a, b) => b.updatedAt - a.updatedAt)
  res.json({ threads })
})

chatRoutes.get('/rides/:rideId/messages', async (req, res) => {
  const { rideId } = req.params
  if (!(await canSeeThread(req.user.id, { rideId }))) return res.status(404).json({ error: 'Chat not found' })

  const since = Number(req.query.since) || 0
  const rows = await db
    .prepare(
      `SELECT m.id, m.body, m.created_at AS "createdAt", m.user_id AS "userId",
              u.name AS "authorName", u.avatar_color AS "avatarColor"
         FROM messages m JOIN users u ON u.id = m.user_id
        WHERE m.ride_id = ? AND m.created_at > ?
        ORDER BY m.created_at ASC LIMIT 300`,
    )
    .all(rideId, since)

  res.json({ messages: rows.map((m) => ({ ...m, createdAt: Number(m.createdAt), isMine: m.userId === req.user.id })) })
})

chatRoutes.post('/rides/:rideId/messages', async (req, res) => {
  const { rideId } = req.params
  if (!(await canSeeThread(req.user.id, { rideId }))) return res.status(404).json({ error: 'Chat not found' })

  const body = String(req.body?.body ?? '').trim()
  if (!body) return res.status(400).json({ error: 'Type a message first', field: 'body' })
  if (body.length > MAX_MESSAGE) return res.status(400).json({ error: 'That message is too long', field: 'body' })

  const id = uid('msg')
  const createdAt = now()
  await db.prepare('INSERT INTO messages (id, ride_id, user_id, body, created_at) VALUES (?,?,?,?,?)')
    .run(id, rideId, req.user.id, body, createdAt)

  res.status(201).json({
    message: {
      id, body, createdAt, userId: req.user.id,
      authorName: req.user.name, avatarColor: req.user.avatar_color, isMine: true,
    },
  })
})

/* ---------------------------------------------------------------- garage -- */

export const garageRoutes = Router()
garageRoutes.use(requireAuth)

const serializeVehicle = (v) => ({
  id: v.id,
  nickname: v.nickname,
  brand: v.brand,
  model: v.model,
  regNo: v.reg_no,
  odometerKm: v.odometer_km,
  insuranceDue: v.insurance_due ? Number(v.insurance_due) : null,
  pucDue: v.puc_due ? Number(v.puc_due) : null,
  serviceDue: v.service_due ? Number(v.service_due) : null,
  createdAt: Number(v.created_at),
})

garageRoutes.get('/', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id)
  res.json({ vehicles: rows.map(serializeVehicle) })
})

function readVehicle(req) {
  const errors = {}
  const nickname = String(req.body?.nickname ?? '').trim()
  const nameError = validateName(nickname, { field: 'Nickname', min: 2, max: 40 })
  if (nameError) errors.nickname = nameError

  const odometerError = validateOdometer(req.body?.odometerKm)
  if (odometerError) errors.odometerKm = odometerError

  const regError = validateRegNo(req.body?.regNo)
  if (regError) errors.regNo = regError

  if (Object.keys(errors).length) return { errors }
  return {
    value: {
      nickname,
      brand: req.body?.brand?.trim() || null,
      model: req.body?.model?.trim() || null,
      reg_no: req.body?.regNo?.trim().toUpperCase() || null,
      odometer_km: req.body?.odometerKm ? Number(req.body.odometerKm) : null,
      insurance_due: Number(req.body?.insuranceDue) || null,
      puc_due: Number(req.body?.pucDue) || null,
      service_due: Number(req.body?.serviceDue) || null,
    },
  }
}

garageRoutes.post('/', async (req, res) => {
  const { value, errors } = readVehicle(req)
  if (errors) return res.status(400).json({ error: 'Check the form', errors })

  const id = uid('veh')
  await db.prepare(
    `INSERT INTO vehicles (id, user_id, nickname, brand, model, reg_no, odometer_km,
       insurance_due, puc_due, service_due, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.id, value.nickname, value.brand, value.model, value.reg_no,
    value.odometer_km, value.insurance_due, value.puc_due, value.service_due, now())

  const saved = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id)
  res.status(201).json({ vehicle: serializeVehicle(saved) })
})

garageRoutes.patch('/:id', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM vehicles WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!existing) return res.status(404).json({ error: 'Vehicle not found' })

  const { value, errors } = readVehicle(req)
  if (errors) return res.status(400).json({ error: 'Check the form', errors })

  await db.prepare(
    `UPDATE vehicles SET nickname=?, brand=?, model=?, reg_no=?, odometer_km=?,
       insurance_due=?, puc_due=?, service_due=? WHERE id=?`,
  ).run(value.nickname, value.brand, value.model, value.reg_no, value.odometer_km,
    value.insurance_due, value.puc_due, value.service_due, existing.id)

  const saved = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(existing.id)
  res.json({ vehicle: serializeVehicle(saved) })
})

garageRoutes.delete('/:id', async (req, res) => {
  const result = await db.prepare('DELETE FROM vehicles WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
  if (!result.changes) return res.status(404).json({ error: 'Vehicle not found' })
  res.json({ deleted: true })
})

/* --------------------------------------------------------- notifications -- */

export const notificationRoutes = Router()
notificationRoutes.use(requireAuth)

notificationRoutes.get('/', async (req, res) => {
  const rows = await db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60')
    .all(req.user.id)
  res.json({
    notifications: rows.map((n) => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body, rideId: n.ride_id,
      readAt: n.read_at ? Number(n.read_at) : null, createdAt: Number(n.created_at),
    })),
    unread: rows.filter((n) => !n.read_at).length,
  })
})

notificationRoutes.post('/read', async (req, res) => {
  await db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
    .run(now(), req.user.id)
  res.json({ ok: true })
})

/* ------------------------------------------------------------- web push -- */

export const pushRoutes = Router()
pushRoutes.use(requireAuth)

// The browser hands back { endpoint, keys: { p256dh, auth } } from
// pushManager.subscribe() — stored as-is so web-push can address it later.
pushRoutes.post('/subscribe', async (req, res) => {
  const sub = req.body?.subscription
  const endpoint = sub?.endpoint
  const p256dh = sub?.keys?.p256dh
  const auth = sub?.keys?.auth
  if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: 'Invalid push subscription' })

  await db.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
  ).run(uid('push'), req.user.id, endpoint, p256dh, auth, now())
  res.status(201).json({ ok: true })
})

pushRoutes.post('/unsubscribe', async (req, res) => {
  const endpoint = req.body?.endpoint
  if (endpoint) await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
  res.json({ ok: true })
})
