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
