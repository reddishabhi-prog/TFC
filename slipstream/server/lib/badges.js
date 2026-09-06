import { db } from './db.js'

/**
 * Every badge is derived from ride history on read — nothing is "awarded" and
 * stored, so a badge can never drift out of sync with the rides behind it, and
 * changing a threshold here re-grades everyone instantly.
 *
 * Locked badges are returned too, with progress, because a rider who can see
 * "3 of 5 rides led" has a reason to come back; a hidden badge motivates nobody.
 */
export const BADGES = [
  { id: 'first-ride',  emoji: '🏍️', name: 'First Ride',   blurb: 'Finish your first ride',        stat: 'ridesCompleted',      target: 1 },
  { id: 'regular',     emoji: '🔁', name: 'Regular',      blurb: 'Finish 5 rides',                stat: 'ridesCompleted',      target: 5 },
  { id: 'veteran',     emoji: '🎖️', name: 'Veteran',      blurb: 'Finish 25 rides',               stat: 'ridesCompleted',      target: 25 },
  { id: 'century',     emoji: '💯', name: 'Century',      blurb: 'Ride 100 km in one go',         stat: 'longestRideKm',       target: 100 },
  { id: 'long-hauler', emoji: '🛣️', name: 'Long Hauler',  blurb: 'Cover 500 km in total',         stat: 'totalKm',             target: 500 },
  { id: 'road-warrior',emoji: '⚡', name: 'Road Warrior', blurb: 'Cover 2,000 km in total',       stat: 'totalKm',             target: 2000 },
  { id: 'pack-leader', emoji: '🧭', name: 'Pack Leader',  blurb: 'Lead 5 rides',                  stat: 'ridesLed',            target: 5 },
  { id: 'storyteller', emoji: '📸', name: 'Storyteller',  blurb: 'Share 10 ride memories',        stat: 'memoriesShared',      target: 10 },
  { id: 'squad',       emoji: '👥', name: 'Squad',        blurb: 'Ride with 10 different riders', stat: 'distinctCompanions',  target: 10 },
]

export async function riderStats(userId) {
  const rides = await db.prepare(
    `SELECT COUNT(*)::int              AS "ridesCompleted",
            COALESCE(SUM(r.distance_km), 0) AS "totalKm",
            COALESCE(MAX(r.distance_km), 0) AS "longestRideKm"
       FROM rides r JOIN ride_members rm ON rm.ride_id = r.id
      WHERE rm.user_id = ? AND r.status = 'ended'`,
  ).get(userId)

  const { ridesLed } = await db.prepare(
    `SELECT COUNT(*)::int AS "ridesLed" FROM rides WHERE leader_id = ? AND status = 'ended'`,
  ).get(userId)

  const { memoriesShared } = await db.prepare(
    'SELECT COUNT(*)::int AS "memoriesShared" FROM memories WHERE user_id = ?',
  ).get(userId)

  const { distinctCompanions } = await db.prepare(
    `SELECT COUNT(DISTINCT other.user_id)::int AS "distinctCompanions"
       FROM ride_members mine
       JOIN ride_members other ON other.ride_id = mine.ride_id AND other.user_id != mine.user_id
      WHERE mine.user_id = ?`,
  ).get(userId)

  return {
    ridesCompleted: rides.ridesCompleted,
    totalKm: Math.round(Number(rides.totalKm)),
    longestRideKm: Math.round(Number(rides.longestRideKm)),
    ridesLed,
    memoriesShared,
    distinctCompanions,
  }
}

export function gradeBadges(stats) {
  return BADGES.map((b) => {
    const current = stats[b.stat] ?? 0
    return {
      id: b.id,
      emoji: b.emoji,
      name: b.name,
      blurb: b.blurb,
      earned: current >= b.target,
      current: Math.min(current, b.target),
      target: b.target,
    }
  })
}
