/**
 * Slipstream's service worker exists mainly so Android treats the app as
 * installable, so it is deliberately conservative: this app is API-driven and
 * redeploys often, and a service worker that caches too eagerly is how a
 * "fixed" bug appears to persist on someone's phone for days.
 *
 * Two rules keep that from happening:
 *   - nothing under /api is ever cached — rides, positions and memories are
 *     live data and must always hit the network
 *   - navigations go to the network first, so a fresh deploy is picked up on
 *     the next launch; the cached shell is only a fallback for being offline
 *
 * Build assets are safe to cache forever because Vite content-hashes their
 * filenames, so a cache hit is always the version that asked for it.
 */
const CACHE = 'slipstream-shell-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request)
        const cache = await caches.open(CACHE)
        cache.put('/index.html', fresh.clone())
        return fresh
      } catch {
        const cached = await caches.match('/index.html')
        if (cached) return cached
        return new Response('You are offline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        })
      }
    })())
    return
  }

  event.respondWith((async () => {
    const hit = await caches.match(request)
    if (hit) return hit
    const res = await fetch(request)
    if (res.ok && res.type === 'basic') {
      const cache = await caches.open(CACHE)
      cache.put(request, res.clone())
    }
    return res
  })())
})

// The payload is whatever lib/push.js's pushNotifyUsers() JSON-serialized —
// { title, body, rideId }. A push with no attached data (or a malformed
// payload) still needs a notification to appear, or the browser prints a
// generic "this site was updated in the background" warning of its own.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() ?? {} } catch { /* non-JSON payload, ignore */ }
  const title = data.title || 'Slipstream'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { rideId: data.rideId ?? null },
      tag: data.rideId ? `ride-${data.rideId}` : undefined,
    }),
  )
})

// Focuses an already-open tab rather than always opening a new one — most
// pushes land while the app is already open in the background.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // The SPA keeps navigation state in memory, not the URL, so there's no
  // route to deep-link into yet — focusing (or opening) the app at all is
  // the win here; the tapped notification's ride is still sitting in the
  // in-app Notifications list once they're in.
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientsList) {
      if ('focus' in client) return client.focus()
    }
    return self.clients.openWindow('/')
  })())
})
