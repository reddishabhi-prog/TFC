import { useEffect, useState } from 'react'
import { Api } from '../services/api'
import { useToast } from '../context/AppContext'
import { Button, EmptyState, SkeletonList } from '../components/ui'
import { Icon } from '../components/Icon'
import { relativeTime } from '../utils/format'
import { pushSupported, currentPushSubscription, enablePush, disablePush } from '../utils/push'

const ICONS = { sos: 'sos', ride_invite: 'bike', ride_joined: 'users' }

/** Ride invites, SOS alerts, and join updates — the bell in the home header
 *  opens this. Visiting the list is what clears the unread badge; there's no
 *  per-row read state, since "I looked at the inbox" is what matters here. */
export function NotificationsScreen({ onBack, onOpenRide }) {
  const toast = useToast()
  const [items, setItems] = useState(null)
  const [pushState, setPushState] = useState('checking') // checking | unsupported | denied | off | on
  const [pushBusy, setPushBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    Api.notifications()
      .then(({ notifications }) => { if (!cancelled) setItems(notifications) })
      .catch(() => { if (!cancelled) setItems([]) })
    Api.readNotifications().catch(() => {})

    async function checkPush() {
      if (!pushSupported()) return setPushState('unsupported')
      if (Notification.permission === 'denied') return setPushState('denied')
      const sub = await currentPushSubscription().catch(() => null)
      if (!cancelled) setPushState(sub ? 'on' : 'off')
    }
    checkPush()
    return () => { cancelled = true }
  }, [])

  async function togglePush() {
    setPushBusy(true)
    try {
      if (pushState === 'on') {
        await disablePush()
        setPushState('off')
      } else {
        await enablePush()
        setPushState('on')
        toast.success("You'll get push alerts on this device")
      }
    } catch (e) {
      toast.error(e.message || 'Could not update push notifications')
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') setPushState('denied')
    } finally {
      setPushBusy(false)
    }
  }

  return (
    <div className="screen screen-enter">
      <header className="app-bar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="arrowLeft" /></button>
        <div className="app-bar-title">
          <div className="app-bar-title-1">Notifications</div>
        </div>
      </header>

      <div className="screen-scroll">
        {pushState !== 'unsupported' && pushState !== 'checking' && (
          <div className="pad" style={{ paddingTop: 'var(--sp-4)' }}>
            <div className="card row" style={{ gap: 10 }}>
              <span className="list-row-icon"><Icon name="bell" size={18} /></span>
              <span className="grow">
                <span className="list-row-title">Push notifications</span>
                <span className="list-row-sub">
                  {pushState === 'denied'
                    ? 'Blocked — allow notifications for this site in your browser settings'
                    : pushState === 'on'
                      ? 'On for this device'
                      : 'Get an alert the moment SOS or a ride update happens'}
                </span>
              </span>
              {pushState !== 'denied' && (
                <Button size="sm" variant={pushState === 'on' ? 'secondary' : 'primary'}
                        loading={pushBusy} onClick={togglePush}>
                  {pushState === 'on' ? 'Turn off' : 'Turn on'}
                </Button>
              )}
            </div>
          </div>
        )}

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
