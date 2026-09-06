import { uid, now } from './db.js'

/**
 * Fans a notification out to several riders at once. Takes a db-like handle
 * (the plain pool-backed `db`, or a transaction's scoped client) so a
 * notification can be written atomically alongside whatever event caused it —
 * a ride created with them on it, an SOS raised, a join.
 */
export async function notifyUsers(dbLike, userIds, { kind, title, body = null, rideId = null }) {
  for (const userId of userIds) {
    await dbLike.prepare(
      `INSERT INTO notifications (id, user_id, ride_id, kind, title, body, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(uid('ntf'), userId, rideId, kind, title, body, now())
  }
}
