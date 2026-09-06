import { useState } from 'react'
import { Button } from './ui'
import { Icon } from './Icon'
import { useToast } from '../context/AppContext'
import { dayLabel } from '../utils/format'
import { downloadTripPdf } from '../utils/tripPdf'

/** Whichever planned day sits closest to right now — the one worth leading
 *  with a weather callout for, clamped to the trip's own first/last day so a
 *  ride not yet started or already finished still highlights something. */
function nearestDay(days) {
  if (!days.length) return null
  const now = Date.now()
  return days.reduce((best, d) => (Math.abs(d.date - now) < Math.abs(best.date - now) ? d : best), days[0])
}

/** Read-only day-by-day trip plan, set once at ride creation via
 *  POST /rides/plan. Editing after creation isn't supported yet — this is
 *  purely the leader's plan for everyone else to see. */
export function RideItinerary({ ride }) {
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const featured = nearestDay(ride.days)

  async function exportPdf() {
    setExporting(true)
    try {
      await downloadTripPdf(ride)
    } catch {
      toast.error('Could not generate the PDF right now')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="screen-scroll">
      <div className="pad stack" style={{ paddingTop: 'var(--sp-4)' }}>
        <div className="card stack">
          <div className="row-between">
            <div className="section-title" style={{ margin: 0 }}>The plan</div>
            <Button size="sm" icon="download" loading={exporting} onClick={exportPdf}>
              PDF
            </Button>
          </div>
          <p className="caption">
            {ride.origin || 'Start'} → {ride.destination || 'Finish'} · {ride.days.length} day{ride.days.length === 1 ? '' : 's'}
            {ride.distanceKm > 0 && ` · ${Math.round(ride.distanceKm)} km`}
          </p>
        </div>

        {featured?.weather && (
          <div className="weather-callout">
            <span className="weather-callout-icon" aria-hidden="true">{featured.weather.emoji}</span>
            <span className="grow">
              <span className="weather-callout-title">{featured.weather.condition || 'Riding weather'}</span>
              <span className="weather-callout-sub">
                Day {featured.index} · {featured.weather.tempMinC}–{featured.weather.tempMaxC}°C
                {!featured.weather.isForecast && ' · typical for these dates'}
              </span>
            </span>
          </div>
        )}

        {ride.days.map((d) => (
          <div className="trip-day" key={d.index}>
            <div className="row-between">
              <span className="strong">Day {d.index} · {dayLabel(d.date)}</span>
              {d.weather && (
                <span className="pill pill-muted">
                  {d.weather.emoji} {d.weather.tempMinC}–{d.weather.tempMaxC}°C
                  {!d.weather.isForecast && ' (typical)'}
                </span>
              )}
            </div>
            {d.place && <div className="list-row-title" style={{ marginTop: 6 }}>{d.place}</div>}
            {d.notes && <p className="caption" style={{ marginTop: 4 }}>{d.notes}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
