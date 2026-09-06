import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Icon } from './Icon'

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const ROUTE_COLORS = ['#e8562b', '#378add', '#1d9e75']

/**
 * There is almost never only one road between two places — OSRM's
 * alternatives hand back every distinct one it found. This draws each as its
 * own coloured line so the rider sees the actual shape of every option
 * before picking which one this trip follows, instead of one being chosen
 * for them by whichever OSRM ranks fastest.
 */
export function RoutePicker({ origin, destination, routes, selected, onSelect }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef([])

  useEffect(() => {
    const map = L.map(elRef.current, { attributionControl: true, zoomControl: true })
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const layer of layersRef.current) layer.remove()
    layersRef.current = []

    const asLatLng = (p) => (Array.isArray(p) ? p : [p.lat, p.lng])

    // Draw every alternative first, selected last, so its line always sits on
    // top of the others where two routes briefly share the same road.
    routes.forEach((route, i) => {
      if (i === selected) return
      const line = L.polyline(route.points.map(asLatLng), {
        color: ROUTE_COLORS[i % ROUTE_COLORS.length], weight: 4, opacity: 0.45,
      }).addTo(map)
      line.on('click', () => onSelect(i))
      layersRef.current.push(line)
    })
    if (routes[selected]) {
      const line = L.polyline(routes[selected].points.map(asLatLng), {
        color: ROUTE_COLORS[selected % ROUTE_COLORS.length], weight: 6, opacity: 0.95,
      }).addTo(map)
      layersRef.current.push(line)
    }

    if (origin) {
      layersRef.current.push(
        L.circleMarker([origin.lat, origin.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#1d9e75', fillOpacity: 1 }).addTo(map),
      )
    }
    if (destination) {
      layersRef.current.push(
        L.circleMarker([destination.lat, destination.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#c42b1c', fillOpacity: 1 }).addTo(map),
      )
    }

    const allPoints = routes.flatMap((r) => r.points.map(asLatLng))
    if (allPoints.length) map.fitBounds(L.latLngBounds(allPoints).pad(0.08))
  }, [routes, selected, origin, destination, onSelect])

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="route-picker-canvas" ref={elRef} />
      <div className="stack" style={{ gap: 6 }}>
        {routes.map((r, i) => (
          <button
            key={i} type="button"
            className={`list-row route-option ${i === selected ? 'on' : ''}`}
            onClick={() => onSelect(i)}
          >
            <span className="route-option-swatch" style={{ background: ROUTE_COLORS[i % ROUTE_COLORS.length] }} aria-hidden="true" />
            <span className="grow">
              <span className="list-row-title">Route {i + 1}{i === 0 ? ' · Suggested' : ''}</span>
              <span className="list-row-sub">
                {r.distanceKm} km · {r.durationHours}h riding · usually {r.recommendedDays}+ day{r.recommendedDays === 1 ? '' : 's'}
              </span>
            </span>
            {i === selected && <Icon name="check" size={17} />}
          </button>
        ))}
      </div>
    </div>
  )
}
