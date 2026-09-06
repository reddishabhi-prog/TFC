import { dayLabel } from '../utils/format'

/** Read-only day-by-day trip plan, set once at ride creation via
 *  POST /rides/plan. Editing after creation isn't supported yet — this is
 *  purely the leader's plan for everyone else to see. */
export function RideItinerary({ ride }) {
  return (
    <div className="screen-scroll">
      <div className="pad stack" style={{ paddingTop: 'var(--sp-4)' }}>
        <div className="card stack">
          <div className="section-title" style={{ margin: 0 }}>The plan</div>
          <p className="caption">
            {ride.origin || 'Start'} → {ride.destination || 'Finish'} · {ride.days.length} day{ride.days.length === 1 ? '' : 's'}
            {ride.distanceKm > 0 && ` · ${Math.round(ride.distanceKm)} km`}
          </p>
        </div>

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
