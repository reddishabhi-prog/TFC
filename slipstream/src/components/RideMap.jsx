import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Free OpenStreetMap tiles, no API key. Their usage policy asks heavier
// production traffic to self-host or use a paid CDN — fine for testing, but
// worth swapping before this app has real load.
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const DEFAULT_CENTER = [20.5937, 78.9629] // geographic centre of India — sane fallback with no riders located yet
const DEFAULT_ZOOM = 5

function initials(name) {
  const words = String(name ?? '?').trim().split(/\s+/).filter(Boolean)
  return words.length > 1
    ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
    : (words[0] || '?').slice(0, 2).toUpperCase()
}

function pinIcon(member, isYou) {
  return L.divIcon({
    className: 'rider-pin-wrap',
    html: `<span class="rider-pin${isYou ? ' rider-pin-you' : ''}" style="background:${member.avatarColor || '#e8562b'}">${initials(member.name)}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

/** Live convoy map: one marker per rider who has shared a location, updated
 *  in place as fresh coordinates arrive instead of re-mounting the map.
 *  Exposes recenter() via ref for a manual "back to the group" control, since
 *  auto-fit deliberately stops fighting the user after the first frame. */
export const RideMap = forwardRef(function RideMap({ members, youId, routePoints }, ref) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(new Map())
  const routeLineRef = useRef(null)
  const membersRef = useRef(members)
  membersRef.current = members
  // Riders already framed at least once. Position updates land every poll —
  // fitBounds on every one of them fights anyone who has zoomed in or panned
  // to actually look at the map, snapping it back a few seconds later. Only
  // reframe when someone's location appears for the first time.
  const framedRef = useRef(new Set())

  useImperativeHandle(ref, () => ({
    recenter() {
      const map = mapRef.current
      const located = membersRef.current.filter((m) => typeof m.lat === 'number' && typeof m.lng === 'number')
      if (!map || !located.length) return
      const bounds = L.latLngBounds(located.map((m) => [m.lat, m.lng]))
      map.fitBounds(bounds.pad(0.35), { maxZoom: 15 })
    },
  }), [])

  useEffect(() => {
    const map = L.map(elRef.current, { attributionControl: true, zoomControl: true })
      .setView(DEFAULT_CENTER, DEFAULT_ZOOM)
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove(); mapRef.current = null
      markersRef.current = new Map(); framedRef.current = new Set(); routeLineRef.current = null
    }
  }, [])

  // The road the leader picked at ride creation, if any — drawn once beneath
  // the rider pins so the group can see the planned line, not just where
  // everyone currently is. Rides created before this feature simply have none.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !Array.isArray(routePoints) || !routePoints.length) return
    const line = L.polyline(routePoints, { color: '#e8562b', weight: 4, opacity: 0.55 }).addTo(map)
    routeLineRef.current = line
    if (!members.some((m) => typeof m.lat === 'number')) {
      map.fitBounds(line.getBounds().pad(0.12))
    }
    return () => line.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePoints])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const located = members.filter((m) => typeof m.lat === 'number' && typeof m.lng === 'number')
    const seen = new Set()

    for (const m of located) {
      seen.add(m.id)
      const existing = markersRef.current.get(m.id)
      if (existing) {
        existing.setLatLng([m.lat, m.lng])
        existing.setIcon(pinIcon(m, m.id === youId))
      } else {
        const marker = L.marker([m.lat, m.lng], { icon: pinIcon(m, m.id === youId) })
          .bindTooltip(m.id === youId ? `${m.name} (you)` : m.name, { direction: 'top', offset: [0, -14] })
          .addTo(map)
        markersRef.current.set(m.id, marker)
      }
    }
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) { marker.remove(); markersRef.current.delete(id) }
    }

    const newlyLocated = located.filter((m) => !framedRef.current.has(m.id))
    if (newlyLocated.length) {
      const bounds = L.latLngBounds(located.map((m) => [m.lat, m.lng]))
      map.fitBounds(bounds.pad(0.35), { maxZoom: 15 })
      for (const m of located) framedRef.current.add(m.id)
    }
  }, [members, youId])

  return <div className="ride-map-canvas" ref={elRef} />
})
