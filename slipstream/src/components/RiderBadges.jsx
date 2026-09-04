import { useEffect, useState } from 'react'
import { Api } from '../services/api'

/** Milestones on the rider's profile. Locked badges stay visible with their
 *  progress — seeing "3 / 5 rides led" is the whole point; a hidden badge
 *  can't pull anyone back for another ride. */
export function RiderBadges() {
  const [data, setData] = useState(null)

  useEffect(() => {
    let cancelled = false
    Api.badges()
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData({ stats: null, badges: [] }) })
    return () => { cancelled = true }
  }, [])

  if (!data) {
    return (
      <div className="section">
        <div className="section-title">Milestones</div>
        <div className="pad"><div className="skeleton" style={{ height: 96, borderRadius: 18 }} /></div>
      </div>
    )
  }
  if (!data.badges.length) return null

  const earned = data.badges.filter((b) => b.earned).length

  return (
    <div className="section">
      <div className="section-title">Milestones · {earned}/{data.badges.length}</div>

      {data.stats && (
        <div className="stat-row">
          <div className="stat-tile">
            <span className="stat-value">{data.stats.ridesCompleted}</span>
            <span className="stat-label">Rides</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{data.stats.totalKm.toLocaleString('en-IN')}</span>
            <span className="stat-label">Km</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{data.stats.distinctCompanions}</span>
            <span className="stat-label">Riders met</span>
          </div>
        </div>
      )}

      <div className="badge-grid">
        {data.badges.map((b) => (
          <div className={`badge ${b.earned ? 'earned' : ''}`} key={b.id}
               title={`${b.name} — ${b.blurb}`}>
            <span className="badge-emoji" aria-hidden="true">{b.emoji}</span>
            <span className="badge-name">{b.name}</span>
            {b.earned ? (
              <span className="badge-state">Earned</span>
            ) : (
              <>
                <span className="badge-track" aria-hidden="true">
                  <span className="badge-fill" style={{ width: `${(b.current / b.target) * 100}%` }} />
                </span>
                <span className="badge-state">{b.current}/{b.target}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
