import { Router } from 'express'
import { del } from '@vercel/blob'
import { handleUpload } from '@vercel/blob/client'
import { db, uid, now } from '../lib/db.js'
import { requireAuth } from '../lib/auth.js'
import { validateName } from '../../src/utils/validate.js'
import { geocode, drivingRoute, reverseGeocode, sampleRoutePoints } from '../lib/geo.js'
import { dayWeather } from '../lib/weather.js'

const MEMORY_CONTENT_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
]
const MEMORY_MAX_BYTES = 25 * 1024 * 1024
const MIN_TRACK_METRES = 25
const MAX_TRIP_DAYS = 30
// OSRM estimates car-driving time; a motorcycle group actually covers a route
// slower — traffic, fuel/chai stops, photos, mountain roads — so raw duration
// is padded before being divided into a daily pace to get a day recommendation.
const MOTORCYCLE_PACE_MULTIPLIER = 1.15
const RIDING_HOURS_PER_DAY = 6

/** Equirectangular approximation — plenty accurate at the scale of "did this
 *  bike move 25 metres", and far cheaper than haversine per location ping. */
function metresBetween(lat1, lng1, lat2, lng2) {
  const toRad = Math.PI / 180
  const x = (lng2 - lng1) * toRad * Math.cos(((lat1 + lat2) / 2) * toRad)
  const y = (lat2 - lat1) * toRad
  return Math.sqrt(x * x + y * y) * 6371000
}

export const rideRoutes = Router()
rideRoutes.use(requireAuth)

// Ambiguous glyphs (0/O, 1/I) are omitted — codes get read aloud and retyped.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
async function freshJoinCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = ''
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    if (!(await db.prepare('SELECT 1 FROM rides WHERE join_code = ?').get(code))) return code
  }
  throw new Error('Could not allocate a unique join code')
}

async function serializeRide(ride, viewerId) {
  const members = (await db
    .prepare(
      `SELECT u.id, u.name, u.avatar_color AS "avatarColor", rm.role,
              rm.lat, rm.lng, rm.location_updated_at AS "locationUpdatedAt"
         FROM ride_members rm JOIN users u ON u.id = rm.user_id
        WHERE rm.ride_id = ? ORDER BY rm.seq`,
    )
    .all(ride.id)).map((m) => ({
    ...m,
    locationUpdatedAt: m.locationUpdatedAt ? Number(m.locationUpdatedAt) : null,
  }))
  const group = await db.prepare('SELECT id FROM groups WHERE ride_id = ?').get(ride.id)
  const days = (await db
    .prepare('SELECT * FROM ride_days WHERE ride_id = ? ORDER BY day_index')
    .all(ride.id)).map((d) => ({
    index: d.day_index,
    date: Number(d.date),
    place: d.place,
    notes: d.notes,
    lat: d.lat,
    lng: d.lng,
    weather: d.weather ?? null, // pg parses JSONB back into a JS object already
  }))
  return {
    id: ride.id,
    name: ride.name,
    description: ride.description,
    origin: ride.origin,
    destination: ride.destination,
    startsAt: Number(ride.starts_at),
    tripEndsAt: ride.trip_ends_at ? Number(ride.trip_ends_at) : null,
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
    createdAt: Number(ride.created_at),
    endedAt: ride.ended_at ? Number(ride.ended_at) : null,
    memoryLimit: ride.memory_limit,
    members,
    days,
    isLeader: ride.leader_id === viewerId,
    groupId: group?.id ?? null,
  }
}

function mapMemoryRow(r) {
  return {
    id: r.id,
    userId: r.user_id,
    authorName: r.author_name,
    authorColor: r.authorColor,
    mediaUrl: r.media_url,
    mediaType: r.media_type,
    caption: r.caption,
    createdAt: Number(r.created_at),
    likeCount: r.likeCount,
    likedByMe: r.likedByMe,
  }
}

const MEMORY_ROW_SELECT = `
  SELECT m.*, u.name AS author_name, u.avatar_color AS "authorColor",
         (SELECT COUNT(*)::int FROM memory_likes WHERE memory_id = m.id) AS "likeCount",
         EXISTS(SELECT 1 FROM memory_likes WHERE memory_id = m.id AND user_id = ?) AS "likedByMe"
    FROM memories m JOIN users u ON u.id = m.user_id`

rideRoutes.get('/', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT r.* FROM rides r JOIN ride_members rm ON rm.ride_id = r.id
        WHERE rm.user_id = ? ORDER BY r.created_at DESC`,
    )
    .all(req.user.id)
  res.json({ rides: await Promise.all(rows.map((r) => serializeRide(r, req.user.id))) })
})

rideRoutes.get('/public', async (req, res) => {
  const rows = await db
    .prepare(`SELECT * FROM rides WHERE visibility = 'public' AND status != 'ended' ORDER BY starts_at ASC LIMIT 30`)
    .all()
  res.json({ rides: await Promise.all(rows.map((r) => serializeRide(r, req.user.id))) })
})

rideRoutes.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const error = validateName(name, { field: 'Ride name', max: 60 })
  if (error) return res.status(400).json({ error, field: 'name' })

  const memberIds = [...new Set([req.user.id, ...(Array.isArray(req.body?.memberIds) ? req.body.memberIds : [])])]
  const leaderId = memberIds.includes(req.body?.leaderId) ? req.body.leaderId : req.user.id
  const visibility = ['private', 'invite', 'public'].includes(req.body?.visibility) ? req.body.visibility : 'private'
  const tripEndsAt = Number(req.body?.tripEndsAt) || null

  // The day-by-day plan is optional (a same-day ride has none) and only ever
  // arrives here as whatever POST /rides/plan returned, possibly edited by
  // the leader — this route trusts its shape but not its size.
  const days = Array.isArray(req.body?.days) ? req.body.days.slice(0, MAX_TRIP_DAYS) : []

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
    join_code: await freshJoinCode(),
    leader_id: leaderId,
    created_by: req.user.id,
    trip_ends_at: tripEndsAt,
    created_at: now(),
  }

  await db.transaction(async (tx) => {
    await tx.prepare(
      `INSERT INTO rides (id, name, description, origin, destination, starts_at, duration_hrs,
         visibility, status, join_code, leader_id, created_by, trip_ends_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      ride.id, ride.name, ride.description, ride.origin, ride.destination, ride.starts_at,
      ride.duration_hrs, ride.visibility, ride.status, ride.join_code, ride.leader_id,
      ride.created_by, ride.trip_ends_at, ride.created_at,
    )

    for (const id of memberIds) {
      await tx.prepare('INSERT INTO ride_members (ride_id, user_id, role, joined_at) VALUES (?,?,?,?)')
        .run(ride.id, id, id === leaderId ? 'leader' : 'rider', now())
    }

    for (const d of days) {
      const index = Number(d?.index)
      const date = Number(d?.date)
      if (!Number.isFinite(index) || !Number.isFinite(date)) continue
      await tx.prepare(
        `INSERT INTO ride_days (id, ride_id, day_index, date, place, notes, lat, lng, weather)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        uid('day'), ride.id, index, date,
        d?.place ? String(d.place).trim().slice(0, 120) : null,
        d?.notes ? String(d.notes).trim().slice(0, 500) : null,
        Number.isFinite(Number(d?.lat)) ? Number(d.lat) : null,
        Number.isFinite(Number(d?.lng)) ? Number(d.lng) : null,
        d?.weather ? JSON.stringify(d.weather) : null,
      )
    }

    // Every ride gets an expense group up front, so "Split" is never empty
    // when riders open it mid-trip.
    const groupId = uid('grp')
    await tx.prepare('INSERT INTO groups (id, name, ride_id, created_by, created_at) VALUES (?,?,?,?,?)')
      .run(groupId, ride.name, ride.id, req.user.id, now())
    for (const id of memberIds) {
      await tx.prepare('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?,?,?)')
        .run(groupId, id, now())
    }
  })()

  const saved = await db.prepare('SELECT * FROM rides WHERE id = ?').get(ride.id)
  res.status(201).json({ ride: await serializeRide(saved, req.user.id) })
})

rideRoutes.post('/join', async (req, res) => {
  const code = String(req.body?.joinCode ?? '').trim().toUpperCase()
  if (code.length !== 6) return res.status(400).json({ error: 'Join codes are 6 characters', field: 'joinCode' })

  const ride = await db.prepare('SELECT * FROM rides WHERE join_code = ?').get(code)
  if (!ride) return res.status(404).json({ error: 'No ride matches that code', field: 'joinCode' })
  if (ride.status === 'ended') return res.status(409).json({ error: 'That ride has already finished' })

  await db.transaction(async (tx) => {
    await tx.prepare('INSERT INTO ride_members (ride_id, user_id, role, joined_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING')
      .run(ride.id, req.user.id, 'rider', now())
    const group = await tx.prepare('SELECT id FROM groups WHERE ride_id = ?').get(ride.id)
    if (group) {
      await tx.prepare('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?,?,?) ON CONFLICT DO NOTHING')
        .run(group.id, req.user.id, now())
    }
  })()

  const saved = await db.prepare('SELECT * FROM rides WHERE id = ?').get(ride.id)
  res.json({ ride: await serializeRide(saved, req.user.id) })
})

/**
 * Maps a multi-day trip before the ride exists: geocodes both ends, routes
 * between them, and — for however many days the leader has actually picked —
 * samples that many evenly-spaced stops along the real road, reverse-geocodes
 * each into a place name, and attaches a weather snapshot. Nominatim's ~1/sec
 * limit means this is genuinely slow for a long trip (a 10-day plan makes
 * ~12 sequential geocoding calls) — the caller is expected to show a loading
 * state, not treat this like an autocomplete-speed lookup.
 */
rideRoutes.post('/plan', async (req, res) => {
  const origin = String(req.body?.origin ?? '').trim()
  const destination = String(req.body?.destination ?? '').trim()
  const startDate = Number(req.body?.startDate)
  const endDate = Number(req.body?.endDate)
  if (!origin) return res.status(400).json({ error: 'Where does this ride start?', field: 'origin' })
  if (!destination) return res.status(400).json({ error: 'Where does this ride end?', field: 'destination' })
  if (!Number.isFinite(startDate) || !Number.isFinite(endDate) || endDate < startDate) {
    return res.status(400).json({ error: 'Pick a valid start and end date' })
  }

  const selectedDays = Math.round((endDate - startDate) / 86400000) + 1
  if (selectedDays > MAX_TRIP_DAYS) {
    return res.status(400).json({ error: `Trips longer than ${MAX_TRIP_DAYS} days aren't supported yet` })
  }

  try {
    // Sequential, not Promise.all: geocode()'s rate limiter shares one
    // last-call timestamp, and concurrent calls would both read it before
    // either updates it, silently defeating the 1/sec throttle.
    const originPoint = await geocode(origin)
    if (!originPoint) return res.status(400).json({ error: `Could not find "${origin}" on the map`, field: 'origin' })
    const destPoint = await geocode(destination)
    if (!destPoint) return res.status(400).json({ error: `Could not find "${destination}" on the map`, field: 'destination' })

    const route = await drivingRoute(originPoint, destPoint)
    const recommendedDays = Math.max(
      1, Math.ceil((route.durationHours * MOTORCYCLE_PACE_MULTIPLIER) / RIDING_HOURS_PER_DAY),
    )

    const stops = sampleRoutePoints(route.points, selectedDays)
    const days = []
    for (let i = 0; i < stops.length; i++) {
      const point = stops[i]
      const date = startDate + i * 86400000
      const isLastDay = i === stops.length - 1
      const place = isLastDay
        ? destPoint.label.split(',')[0]
        : (await reverseGeocode(point.lat, point.lng)) || `Day ${i + 1}`
      const weather = await dayWeather(point.lat, point.lng, date)
      days.push({ index: i + 1, date, place, lat: point.lat, lng: point.lng, weather })
    }

    res.json({
      origin: { label: originPoint.label.split(',').slice(0, 2).join(','), lat: originPoint.lat, lng: originPoint.lng },
      destination: { label: destPoint.label.split(',').slice(0, 2).join(','), lat: destPoint.lat, lng: destPoint.lng },
      distanceKm: Math.round(route.distanceKm),
      drivingHours: Math.round(route.durationHours * 10) / 10,
      recommendedDays,
      selectedDays,
      tooShort: selectedDays < recommendedDays,
      days,
    })
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not plan that route right now — try again in a moment' })
  }
})

async function loadRide(req, res, next) {
  const ride = await db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id)
  if (!ride) return res.status(404).json({ error: 'Ride not found' })
  const member = await db.prepare('SELECT 1 FROM ride_members WHERE ride_id = ? AND user_id = ?').get(ride.id, req.user.id)
  if (!member && ride.visibility !== 'public') return res.status(404).json({ error: 'Ride not found' })
  req.ride = ride
  next()
}

rideRoutes.get('/:id', loadRide, async (req, res) => res.json({ ride: await serializeRide(req.ride, req.user.id) }))

rideRoutes.patch('/:id', loadRide, async (req, res) => {
  if (req.ride.leader_id !== req.user.id && req.ride.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Only the ride leader can change this ride' })
  }
  const b = req.body ?? {}
  const status = ['live', 'paused', 'ended'].includes(b.status) ? b.status : req.ride.status
  const justEnded = status === 'ended' && req.ride.status !== 'ended'
  const memoryLimit = Number.isFinite(Number(b.memoryLimit))
    ? Math.min(50, Math.max(1, Math.round(Number(b.memoryLimit))))
    : req.ride.memory_limit
  await db.prepare(
    `UPDATE rides SET status=?, distance_km=?, rating=?, notes=?, fuel_cost=?, leader_id=?, memory_limit=?, ended_at=? WHERE id=?`,
  ).run(
    status,
    b.distanceKm ?? (justEnded ? await trackDistanceKm(req.ride.id) : req.ride.distance_km),
    b.rating ?? req.ride.rating,
    b.notes ?? req.ride.notes,
    b.fuelCost ?? req.ride.fuel_cost,
    b.leaderId ?? req.ride.leader_id,
    memoryLimit,
    status === 'ended' ? (req.ride.ended_at ?? now()) : null,
    req.ride.id,
  )
  const saved = await db.prepare('SELECT * FROM rides WHERE id = ?').get(req.ride.id)
  res.json({ ride: await serializeRide(saved, req.user.id) })
})

// Riders push their own position every few seconds while a ride is live;
// everyone else picks it up on their next GET /rides/:id poll. No
// broadcast/socket layer needed for a few riders' worth of traffic.
rideRoutes.post('/:id/location', loadRide, async (req, res) => {
  const lat = Number(req.body?.lat)
  const lng = Number(req.body?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'lat/lng must be valid coordinates' })
  }
  const { changes } = await db.prepare(
    'UPDATE ride_members SET lat = ?, lng = ?, location_updated_at = ? WHERE ride_id = ? AND user_id = ?',
  ).run(lat, lng, now(), req.ride.id, req.user.id)
  if (!changes) return res.status(403).json({ error: 'Only ride members can share their location' })

  // Append a breadcrumb only once the rider has actually moved, so a bike
  // parked at a chai stop doesn't write a point every 8 seconds all afternoon.
  const last = await db.prepare(
    'SELECT lat, lng FROM ride_track WHERE ride_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
  ).get(req.ride.id, req.user.id)
  if (!last || metresBetween(last.lat, last.lng, lat, lng) >= MIN_TRACK_METRES) {
    await db.prepare('INSERT INTO ride_track (ride_id, user_id, lat, lng, created_at) VALUES (?,?,?,?,?)')
      .run(req.ride.id, req.user.id, lat, lng, now())
  }
  res.status(204).end()
})

/**
 * How far the ride actually went, from the longest breadcrumb trail any rider
 * recorded. Computed once when the ride ends, because nothing else ever wrote
 * distance_km: the share card headlines it, the home list shows it, and the
 * distance badges count it, so leaving it at 0 made all three permanently
 * blank and the distance milestones unearnable.
 */
async function trackDistanceKm(rideId) {
  const best = await db.prepare(
    `SELECT user_id AS "userId", COUNT(*)::int AS points FROM ride_track
      WHERE ride_id = ? GROUP BY user_id ORDER BY points DESC LIMIT 1`,
  ).get(rideId)
  if (!best || best.points < 2) return 0

  const points = await db.prepare(
    'SELECT lat, lng FROM ride_track WHERE ride_id = ? AND user_id = ? ORDER BY created_at ASC',
  ).all(rideId, best.userId)

  let metres = 0
  for (let i = 1; i < points.length; i++) {
    metres += metresBetween(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
  }
  return Math.round(metres / 100) / 10
}

// The finished ride's shape, for the end-of-ride share card: the leader's
// breadcrumbs if they have any, otherwise whoever tracked the most.
rideRoutes.get('/:id/track', loadRide, async (req, res) => {
  const best = await db.prepare(
    `SELECT user_id AS "userId", COUNT(*)::int AS points FROM ride_track
      WHERE ride_id = ? GROUP BY user_id ORDER BY (user_id = ?) DESC, points DESC LIMIT 1`,
  ).get(req.ride.id, req.ride.leader_id)
  if (!best) return res.json({ points: [] })

  const points = await db.prepare(
    'SELECT lat, lng FROM ride_track WHERE ride_id = ? AND user_id = ? ORDER BY created_at ASC',
  ).all(req.ride.id, best.userId)
  res.json({ points })
})

rideRoutes.get('/:id/checklist', loadRide, async (req, res) => {
  const items = await db.prepare('SELECT id, label FROM checklist_items WHERE ride_id = ? ORDER BY seq').all(req.ride.id)
  const myChecks = (await db.prepare(
    `SELECT cc.item_id AS "itemId" FROM checklist_checks cc
       JOIN checklist_items ci ON ci.id = cc.item_id
      WHERE ci.ride_id = ? AND cc.user_id = ?`,
  ).all(req.ride.id, req.user.id)).map((r) => r.itemId)

  const readiness = await db.prepare(
    `SELECT u.id AS "userId", u.name, u.avatar_color AS "avatarColor",
            (SELECT COUNT(*)::int FROM checklist_checks cc
               JOIN checklist_items ci ON ci.id = cc.item_id
              WHERE ci.ride_id = ? AND cc.user_id = rm.user_id) AS "checkedCount"
       FROM ride_members rm JOIN users u ON u.id = rm.user_id
      WHERE rm.ride_id = ? ORDER BY rm.seq`,
  ).all(req.ride.id, req.ride.id)

  res.json({ items, myChecks, readiness })
})

rideRoutes.post('/:id/checklist/items', loadRide, async (req, res) => {
  if (req.ride.leader_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the ride leader can edit the checklist' })
  }
  const label = String(req.body?.label ?? '').trim()
  if (!label) return res.status(400).json({ error: 'Item text is required', field: 'label' })
  if (label.length > 80) return res.status(400).json({ error: 'Keep it under 80 characters', field: 'label' })

  const id = uid('chk')
  await db.prepare('INSERT INTO checklist_items (id, ride_id, label, created_at) VALUES (?,?,?,?)')
    .run(id, req.ride.id, label, now())
  res.status(201).json({ item: { id, label } })
})

rideRoutes.delete('/:id/checklist/items/:itemId', loadRide, async (req, res) => {
  if (req.ride.leader_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the ride leader can edit the checklist' })
  }
  await db.prepare('DELETE FROM checklist_items WHERE id = ? AND ride_id = ?').run(req.params.itemId, req.ride.id)
  res.status(204).end()
})

rideRoutes.post('/:id/checklist/items/:itemId/check', loadRide, async (req, res) => {
  const item = await db.prepare('SELECT 1 FROM checklist_items WHERE id = ? AND ride_id = ?')
    .get(req.params.itemId, req.ride.id)
  if (!item) return res.status(404).json({ error: 'Checklist item not found' })
  const member = await db.prepare('SELECT 1 FROM ride_members WHERE ride_id = ? AND user_id = ?')
    .get(req.ride.id, req.user.id)
  if (!member) return res.status(403).json({ error: 'Only ride members can tick the checklist' })

  const existing = await db.prepare('SELECT 1 FROM checklist_checks WHERE item_id = ? AND user_id = ?')
    .get(req.params.itemId, req.user.id)
  if (existing) {
    await db.prepare('DELETE FROM checklist_checks WHERE item_id = ? AND user_id = ?')
      .run(req.params.itemId, req.user.id)
  } else {
    await db.prepare('INSERT INTO checklist_checks (item_id, user_id, checked_at) VALUES (?,?,?)')
      .run(req.params.itemId, req.user.id, now())
  }
  res.json({ checked: !existing })
})

async function memoryCountFor(rideId, userId) {
  const { count } = await db.prepare(
    'SELECT COUNT(*)::int AS count FROM memories WHERE ride_id = ? AND user_id = ?',
  ).get(rideId, userId)
  return count
}

rideRoutes.get('/:id/memories', loadRide, async (req, res) => {
  const rows = await db.prepare(`${MEMORY_ROW_SELECT} WHERE m.ride_id = ? ORDER BY m.created_at DESC`)
    .all(req.user.id, req.ride.id)
  res.json({
    memories: rows.map(mapMemoryRow),
    memoryLimit: req.ride.memory_limit,
    usedByMe: await memoryCountFor(req.ride.id, req.user.id),
  })
})

rideRoutes.post('/:id/memories', loadRide, async (req, res) => {
  const member = await db.prepare('SELECT 1 FROM ride_members WHERE ride_id = ? AND user_id = ?').get(req.ride.id, req.user.id)
  if (!member) return res.status(403).json({ error: 'Only ride members can share memories' })

  const mediaUrl = String(req.body?.mediaUrl ?? '').trim()
  if (!mediaUrl) return res.status(400).json({ error: 'mediaUrl is required' })
  const mediaType = req.body?.mediaType === 'video' ? 'video' : 'photo'

  const used = await memoryCountFor(req.ride.id, req.user.id)
  if (used >= req.ride.memory_limit) {
    return res.status(403).json({ error: `You've reached this ride's limit of ${req.ride.memory_limit} memories` })
  }

  const memory = {
    id: uid('mem'),
    ride_id: req.ride.id,
    user_id: req.user.id,
    media_url: mediaUrl,
    media_type: mediaType,
    caption: req.body?.caption ? String(req.body.caption).trim().slice(0, 500) : null,
    created_at: now(),
  }
  await db.prepare(
    `INSERT INTO memories (id, ride_id, user_id, media_url, media_type, caption, created_at) VALUES (?,?,?,?,?,?,?)`,
  ).run(memory.id, memory.ride_id, memory.user_id, memory.media_url, memory.media_type, memory.caption, memory.created_at)

  const saved = await db.prepare(`${MEMORY_ROW_SELECT} WHERE m.id = ?`).get(req.user.id, memory.id)
  res.status(201).json({ memory: mapMemoryRow(saved) })
})

rideRoutes.post('/:id/memories/:memoryId/like', loadRide, async (req, res) => {
  const memory = await db.prepare('SELECT 1 FROM memories WHERE id = ? AND ride_id = ?').get(req.params.memoryId, req.ride.id)
  if (!memory) return res.status(404).json({ error: 'Memory not found' })

  const existing = await db.prepare('SELECT 1 FROM memory_likes WHERE memory_id = ? AND user_id = ?')
    .get(req.params.memoryId, req.user.id)
  if (existing) {
    await db.prepare('DELETE FROM memory_likes WHERE memory_id = ? AND user_id = ?').run(req.params.memoryId, req.user.id)
  } else {
    await db.prepare('INSERT INTO memory_likes (memory_id, user_id, created_at) VALUES (?,?,?)')
      .run(req.params.memoryId, req.user.id, now())
  }
  const { count } = await db.prepare('SELECT COUNT(*)::int AS count FROM memory_likes WHERE memory_id = ?')
    .get(req.params.memoryId)
  res.json({ liked: !existing, likeCount: count })
})

rideRoutes.delete('/:id/memories/:memoryId', loadRide, async (req, res) => {
  const memory = await db.prepare('SELECT * FROM memories WHERE id = ? AND ride_id = ?').get(req.params.memoryId, req.ride.id)
  if (!memory) return res.status(404).json({ error: 'Memory not found' })
  if (memory.user_id !== req.user.id && req.ride.leader_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the author or ride leader can remove this' })
  }
  await db.prepare('DELETE FROM memories WHERE id = ?').run(memory.id)
  // Best-effort: reclaim the stored file too. A failure here (token not
  // configured, blob already gone) shouldn't block removing the post itself.
  await del(memory.media_url).catch(() => {})
  res.status(204).end()
})

// Client-upload handshake: the browser never sends the file through this
// server (Express is capped at 1mb bodies and Vercel functions have their
// own payload ceiling) — it uploads straight to Blob storage using a
// short-lived token minted here, after checking membership and the ride's
// per-rider limit so nobody can burn storage past their cap.
rideRoutes.post('/:id/memories/blob-upload', loadRide, async (req, res) => {
  // Without a store connected, @vercel/blob throws a generic token error that
  // reaches the rider as "Failed to retrieve the client token" — say what is
  // actually wrong instead.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[slipstream] BLOB_READ_WRITE_TOKEN is not set for this deployment')
    return res.status(503).json({
      error: 'Photo storage is not configured yet. Connect a Vercel Blob store to this project.',
    })
  }
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async () => {
        const member = await db.prepare('SELECT 1 FROM ride_members WHERE ride_id = ? AND user_id = ?')
          .get(req.ride.id, req.user.id)
        if (!member) throw new Error('Only ride members can share memories')
        const used = await memoryCountFor(req.ride.id, req.user.id)
        if (used >= req.ride.memory_limit) {
          throw new Error(`You've reached this ride's limit of ${req.ride.memory_limit} memories`)
        }
        return {
          allowedContentTypes: MEMORY_CONTENT_TYPES,
          maximumSizeInBytes: MEMORY_MAX_BYTES,
          addRandomSuffix: true,
        }
      },
    })
    res.json(jsonResponse)
  } catch (err) {
    // The client SDK reports every failure here as "Failed to retrieve the
    // client token", so the real reason has to reach the logs from this side.
    console.error('[slipstream] blob-upload failed:', err?.message, err)
    res.status(400).json({ error: err.message })
  }
})
