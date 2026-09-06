import webpush from 'web-push'
import { db } from './db.js'

// Presence-gated, same as the rest of this app's optional integrations
// (Blob, SMS): a missing key pair means push is silently a no-op rather
// than a boot-time crash, so local dev and a not-yet-configured deploy
// keep working — the in-app notification list still gets everything.
const configured = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
if (configured) {
  webpush.setVapidDetails(
    'mailto:support@slipstream.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  )
}

async function pushToUser(userId, payload) {
  const subs = await db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId)
  if (!subs.length) return
  const body = JSON.stringify(payload)
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      )
    } catch (err) {
      // The browser revoked it, or the user cleared site data — stop
      // retrying a dead endpoint forever instead of erroring every time.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id)
      }
    }
  }))
}

/**
 * Fires a real browser push to every device each user has registered.
 * Always call this OUTSIDE any open db.transaction: it makes its own pool
 * queries (subscription lookup, dead-subscription cleanup), and Vercel's
 * pool is capped at one connection — calling it from inside a transaction
 * would deadlock waiting for the connection the transaction is holding.
 * Best-effort throughout: a push failing never blocks or rolls back the
 * in-app notification it rides alongside.
 */
export async function pushNotifyUsers(userIds, { title, body = null, rideId = null }) {
  if (!configured || !userIds?.length) return
  const payload = { title, body, rideId }
  await Promise.all(userIds.map((id) => pushToUser(id, payload).catch(() => {})))
}
