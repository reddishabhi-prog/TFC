/**
 * Free, keyless geocoding and routing built on the OpenStreetMap ecosystem —
 * same choice as the live map (Leaflet + OSM tiles) and for the same reason:
 * no API key, no billing account, nothing new for the user to set up.
 *
 * Nominatim's usage policy caps this at ~1 request/second and asks for a
 * descriptive User-Agent identifying the app — both enforced here so a burst
 * of geocoding calls (one route plan touches it 2 + N times, N = trip days)
 * doesn't get the whole app rate-limited.
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'
const OSRM_BASE = 'https://router.project-osrm.org'
const USER_AGENT = 'Slipstream/1.0 (motorcycle group-ride planner)'

let lastNominatimCall = 0
async function throttleNominatim() {
  const wait = 1100 - (Date.now() - lastNominatimCall)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastNominatimCall = Date.now()
}

/** Place name -> {lat, lng, label}, or null if nothing matched. */
export async function geocode(place) {
  await throttleNominatim()
  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(place)}&format=json&limit=1`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error('Could not look up that place right now')
  const rows = await res.json()
  if (!rows.length) return null
  return { lat: Number(rows[0].lat), lng: Number(rows[0].lon), label: rows[0].display_name }
}

/** {lat, lng} -> a short place label ("Manali, Himachal Pradesh"), or null. */
export async function reverseGeocode(lat, lng) {
  await throttleNominatim()
  const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) return null
  const row = await res.json()
  const a = row.address ?? {}
  const place = a.city || a.town || a.village || a.county || a.state_district
  return [place, a.state].filter(Boolean).join(', ') || row.display_name || null
}

/**
 * Driving route between two points via OSRM's public demo server: total
 * distance/duration plus the road geometry, so day stops can be sampled
 * along the actual route rather than a straight line between endpoints.
 */
export async function drivingRoute(from, to) {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Could not map that route right now')
  const data = await res.json()
  const route = data.routes?.[0]
  if (!route) throw new Error('No driving route found between those two places')
  return {
    distanceKm: route.distance / 1000,
    durationHours: route.duration / 3600,
    points: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
  }
}

function haversineKm(a, b) {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * `count` points spread evenly along the route by distance travelled, not by
 * array index — so a long straight highway stretch doesn't crowd every
 * sample into one short winding section elsewhere on the route.
 */
export function sampleRoutePoints(points, count) {
  if (count <= 0) return []
  if (points.length < 2) return points[0] ? Array(count).fill(points[0]) : []

  const distances = [0]
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + haversineKm(points[i - 1], points[i]))
  }
  const total = distances[distances.length - 1]

  const out = []
  for (let day = 1; day <= count; day++) {
    const target = (total * day) / count
    const idx = distances.findIndex((d) => d >= target)
    out.push(points[idx === -1 ? points.length - 1 : idx])
  }
  return out
}
