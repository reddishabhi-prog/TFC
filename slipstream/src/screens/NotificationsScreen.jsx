import { useEffect, useState } from 'react'
import { Api } from '../services/api'
import { EmptyState, SkeletonList } from '../components/ui'
import { Icon } from '../components/Icon'
import { relativeTime } from '../utils/format'

const ICONS = { sos: 'sos', ride_invite: 'bike', ride_joined: 'users' }

/** Ride invites, SOS alerts, and join updates — the bell in the home header
 *  opens this. Visiting the list is what clears the unread badge; there's no
 *  per-row read state, since "I looked at the inbox" is what matters here. */
export function NotificationsScreen({ onBack, onOpenRide }) {
  const [items, setItems] = useState(null)

  useEffect(() => {
    let cancelled = false
    Api.notifications()
      .then(({ notifications }) => { if (!cancelled) setItems(notifications) })
      .catch(() => { if (!cancelled) setItems([]) })
    Api.readNotifications().catch(() => {})
    return () => { cancelled = true }
  }, [])

  return (
    <div className="screen screen-enter">
      <header className="app-bar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="arrowLeft" /></button>
        <div className="app-bar-title">
          <div className="app-bar-title-1">Notifications</div>
        </div>
      </header>

      <div className="screen-scroll">
        <div className="section">
          {items === null ? (
            <SkeletonList rows={4} />
          ) : items.length === 0 ? (
            <EmptyState icon="🔔" title="Nothing yet"
                        body="Ride invites, SOS alerts, and join updates will show up here." />
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {items.map((n) => (
                <button
                  key={n.id}
                  className={`list-row notification-row ${n.readAt ? '' : 'unread'} ${n.kind === 'sos' ? 'is-sos' : ''}`}
                  onClick={() => n.rideId && onOpenRide(n.rideId)}
                  disabled={!n.rideId}
                >
                  <span className="list-row-icon"><Icon name={ICONS[n.kind] || 'bell'} size={18} /></span>
                  <span className="grow">
                    <span className="list-row-title">{n.title}</span>
                    {n.body && <span className="list-row-sub">{n.body}</span>}
                  </span>
                  <span className="caption">{relativeTime(n.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
