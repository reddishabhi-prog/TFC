import { Router } from 'express'
import { db, uid, now } from '../lib/db.js'
import { requireAuth } from '../lib/auth.js'
import { validateName } from '../../src/utils/validate.js'

export const rideRoutes = Router()
rideRoutes.use(requireAuth)

// Ambiguous glyphs (0/O, 1/I) are omitted — codes get read aloud and retyped.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function freshJoinCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = ''
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    if (!db.prepare('SELECT 1 FROM rides WHERE join_code = ?').get(code)) return code
  }
  throw new Error('Could not allocate a unique join code')
}

function serializeRide(ride, viewerId) {
  const members = db
    .prepare(
      `SELECT u.id, u.name, u.avatar_color AS avatarColor, rm.role
         FROM ride_members rm JOIN users u ON u.id = rm.user_id
        WHERE rm.ride_id = ? ORDER BY rm.rowid`,
    )
    .all(ride.id)
  return {
    id: ride.id,
    name: ride.name,
    description: ride.description,
    origin: ride.origin,
    destination: ride.destination,
    startsAt: ride.starts_at,
    durationHrs: ride.duration_hrs,
    visibility: ride.visibility,
    status: ride.status,
    joinCode: ride.join_code,
    leaderId: ride.leader_id,
    createdBy: ride.created_by,
    distanceKm: ride.distance_km,
    rating: ride.rating,
    notes: ride.notes,
    fuelCost: ride.fuel_cost,
    createdAt: ride.created_at,
    endedAt: ride.ended_at,
    members,
    isLeader: ride.leader_id === viewerId,
    groupId: db.prepare('SELECT id FROM groups WHERE ride_id = ?').get(ride.id)?.id ?? null,
  }
}

rideRoutes.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.* FROM rides r JOIN ride_members rm ON rm.ride_id = r.id
        WHERE rm.user_id = ? ORDER BY r.created_at DESC`,
    )
    .all(req.user.id)
  res.json({ rides: rows.map((r) => serializeRide(r, req.user.id)) })
})

rideRoutes.get('/public', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM rides WHERE visibility = 'public' AND status != 'ended' ORDER BY starts_at ASC LIMIT 30`)
    .all()
  res.json({ rides: rows.map((r) => serializeRide(r, req.user.id)) })
})

rideRoutes.post('/', (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const error = validateName(name, { field: 'Ride name', max: 60 })
  if (error) return res.status(400).json({ error, field: 'name' })

  const memberIds = [...new Set([req.user.id, ...(Array.isArray(req.body?.memberIds) ? req.body.memberIds : [])])]
  const leaderId = memberIds.includes(req.body?.leaderId) ? req.body.leaderId : req.user.id
  const visibility = ['private', 'invite', 'public'].includes(req.body?.visibility) ? req.body.visibility : 'private'

  const ride = {
    id: uid('rid'),
    name,
    description: req.body?.description ?? null,
    origin: req.body?.origin ?? null,
    destination: req.body?.destination ?? null,
    starts_at: Number(req.body?.startsAt) || now(),
    duration_hrs: Number(req.body?.durationHrs) || null,
    visibility,
    status: 'live',
    join_code: freshJoinCode(),
    leader_id: leaderId,
    created_by: req.user.id,
    created_at: now(),
  }

  db.transaction(() => {
    db.prepare(
      `INSERT INTO rides (id, name, description, origin, destination, starts_at, duration_hrs,
         visibility, status, join_code, leader_id, created_by, created_at)
       VALUES (@id,@name,@description,@origin,@destination,@starts_at,@duration_hrs,
         @visibility,@status,@join_code,@leader_id,@created_by,@created_at)`,
    ).run(ride)

    const addMember = db.prepare('INSERT INTO ride_members (ride_id, user_id, role, joined_at) VALUES (?,?,?,?)')
    for (const id of memberIds) addMember.run(ride.id, id, id === leaderId ? 'leader' : 'rider', now())

    // Every ride gets an expense group up front, so "Split" is never empty
    // when riders open it mid-trip.
    const groupId = uid('grp')
    db.prepare('INSERT INTO groups (id, name, ride_id, created_by, created_at) VALUES (?,?,?,?,?)')
      .run(groupId, ride.name, ride.id, req.user.id, now())
    const addToGroup = db.prepare('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?,?,?)')
    for (const id of memberIds) addToGroup.run(groupId, id, now())
  })()

  res.status(201).json({ ride: serializeRide(db.prepare('SELECT * FROM rides WHERE id = ?').get(ride.id), req.user.id) })
})

rideRoutes.post('/join', (req, res) => {
  const code = String(req.body?.joinCode ?? '').trim().toUpperCase()
  if (code.length !== 6) return res.status(400).json({ error: 'Join codes are 6 characters', field: 'joinCode' })

  const ride = db.prepare('SELECT * FROM rides WHERE join_code = ?').get(code)
  if (!ride) return res.status(404).json({ error: 'No ride matches that code', field: 'joinCode' })
  if (ride.status === 'ended') return res.status(409).json({ error: 'That ride has already finished' })

  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO ride_members (ride_id, user_id, role, joined_at) VALUES (?,?,?,?)')
      .run(ride.id, req.user.id, 'rider', now())
    const group = db.prepare('SELECT id FROM groups WHERE ride_id = ?').get(ride.id)
    if (group) {
      db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?,?,?)')
        .run(group.id, req.user.id, now())
    }
  })()

  res.json({ ride: serializeRide(db.prepare('SELECT * FROM rides WHERE id = ?').get(ride.id), req.user.id) })
})

function loadRide(req, res, next) {
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id)
  if (!ride) return res.status(404).json({ error: 'Ride not found' })
  const member = db.prepare('SELECT 1 FROM ride_members WHERE ride_id = ? AND user_id = ?').get(ride.id, req.user.id)
  if (!member && ride.visibility !== 'public') return res.status(404).json({ error: 'Ride not found' })
  req.ride = ride
  next()
}

rideRoutes.get('/:id', loadRide, (req, res) => res.json({ ride: serializeRide(req.ride, req.user.id) }))

rideRoutes.patch('/:id', loadRide, (req, res) => {
  if (req.ride.leader_id !== req.user.id && req.ride.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Only the ride leader can change this ride' })
  }
  const b = req.body ?? {}
  const status = ['live', 'paused', 'ended'].includes(b.status) ? b.status : req.ride.status
  db.prepare(
    `UPDATE rides SET status=?, distance_km=?, rating=?, notes=?, fuel_cost=?, leader_id=?, ended_at=?
      WHERE id=?`,
  ).run(
    status,
    b.distanceKm ?? req.ride.distance_km,
    b.rating ?? req.ride.rating,
    b.notes ?? req.ride.notes,
    b.fuelCost ?? req.ride.fuel_cost,
    b.leaderId ?? req.ride.leader_id,
    status === 'ended' ? (req.ride.ended_at ?? now()) : null,
    req.ride.id,
  )
  res.json({ ride: serializeRide(db.prepare('SELECT * FROM rides WHERE id = ?').get(req.ride.id), req.user.id) })
})
