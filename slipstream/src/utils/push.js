import { Api } from '../services/api'

// The VAPID public key is meant to be public — it's baked into the client
// bundle at build time via Vite's env handling, the same pattern as VITE_API_URL.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && Boolean(VAPID_PUBLIC_KEY)

/** PushManager wants the VAPID key as a Uint8Array, not the base64url string it's shipped as. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

/** The subscription already sitting with the browser's push service, if any — used to show "on" vs "off" without a server round trip. */
export async function currentPushSubscription() {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

/** Asks for notification permission (if not already answered) and registers this device for push. Throws if the user declines or the browser refuses. */
export async function enablePush() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications were not allowed for this browser')

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  await Api.subscribePush(subscription.toJSON())
  return subscription
}

export async function disablePush() {
  const subscription = await currentPushSubscription()
  if (!subscription) return
  await Api.unsubscribePush(subscription.endpoint).catch(() => {})
  await subscription.unsubscribe()
}
