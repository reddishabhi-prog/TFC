import { useEffect, useState } from 'react'
import { Api } from '../services/api'
import { useAuth, useToast } from '../context/AppContext'
import { Button, EmptyState, SkeletonList, Pill, AvatarStack } from '../components/ui'
import { Icon } from '../components/Icon'
import { firstName, dateTimeLabel, rupees } from '../utils/format'

const QUICK_TILES = [
  { id: 'split',     icon: 'split',     label: 'Split expenses', sub: 'Balances & settle-up' },
  { id: 'chat',      icon: 'chat',      label: 'Rider chat',     sub: 'Group & DMs' },
  { id: 'garage',    icon: 'bike',      label: 'Bike garage',    sub: 'Docs & service' },
  { id: 'discover',  icon: 'map',       label: 'Upcoming rides', sub: 'Community events' },
]

export function HomeScreen({ onNavigate, onOpenRide }) {
  const { user } = useAuth()
  const toast = useToast()
  const [rides, setRides] = useState(null)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    let cancelled = false
    Api.rides()
      .then((r) => { if (!cancelled) setRides(r.rides) })
      .catch(() => { if (!cancelled) setRides([]) })
    return () => { cancelled = true }
  }, [])

  const live = rides?.find((r) => r.status === 'live' || r.status === 'paused')
  const past = rides?.filter((r) => r.status === 'ended') ?? []

  async function join() {
    if (joinCode.length !== 6) return
    setJoining(true)
    try {
      const { ride } = await Api.joinRide(joinCode)
      toast.success(`Joined ${ride.name}`)
      setJoinCode('')
      onOpenRide(ride.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="screen screen-enter">
      <header className="app-bar">
        <div className="app-bar-title">
          <div className="caption">Welcome back</div>
          <div className="app-bar-title-1 home-greeting">
            Hey {firstName(user?.name) || 'rider'} 👋
          </div>
        </div>
        <button className="icon-btn" aria-label="Notifications" onClick={() => onNavigate('notifications')}>
          <Icon name="bell" />
        </button>
      </header>

      <div className="screen-scroll">
        <div className="pad">
          {live ? (
            <button className="hero-card live-hero" onClick={() => onOpenRide(live.id)}>
              <div className="row-between">
                <span className="hero-eyebrow">
                  <span className="live-dot" /> {live.status === 'paused' ? 'Paused' : 'Live now'}
                </span>
                <AvatarStack people={live.members} />
              </div>
              <div className="hero-title">{live.name}</div>
              <div className="hero-body">
                {live.destination ? `Heading to ${live.destination}` : 'Tracking your pack'} ·{' '}
                {live.members.length} rider{live.members.length === 1 ? '' : 's'}
              </div>
              <span className="btn btn-primary" style={{ marginTop: 'var(--sp-4)' }}>
                <Icon name="arrowRight" size={17} /> Back to the ride
              </span>
            </button>
          ) : (
            <div className="hero-card">
              <div className="hero-eyebrow">Your next ride starts here</div>
              <div className="hero-title">Rally the pack in seconds.</div>
              <div className="hero-body">
                Start a ride, share the join code, and everyone lands on the same live map.
              </div>
              <Button variant="primary" icon="plus" style={{ marginTop: 'var(--sp-4)' }}
                      onClick={() => onNavigate('create-ride')}>
                Start a ride
              </Button>
            </div>
          )}
        </div>

        <div className="section">
          <div className="quick-grid">
            {QUICK_TILES.map((t) => (
              <button key={t.id} className="quick-tile" onClick={() => onNavigate(t.id)}>
                <span className="quick-tile-icon"><Icon name={t.icon} size={19} /></span>
                <span className="quick-tile-label">{t.label}</span>
                <span className="quick-tile-sub">{t.sub}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="section-title">Join a ride</div>
          <div className="join-row">
            <input
              className="input join-input"
              placeholder="ABCDEF"
              value={joinCode}
              maxLength={6}
              aria-label="Six letter join code"
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && join()}
            />
            <Button variant="ground" onClick={join} loading={joining} disabled={joinCode.length !== 6}>
              Join
            </Button>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Recent rides</div>
          {rides === null ? (
            <SkeletonList rows={2} />
          ) : past.length === 0 ? (
            <EmptyState
              icon="🗺️"
              title="No rides yet"
              body="Your finished rides and their summaries will show up here."
            />
          ) : (
            <div className="stack">
              {past.slice(0, 6).map((r) => (
                <button key={r.id} className="list-row" onClick={() => onOpenRide(r.id)}>
                  <span className="list-row-icon"><Icon name="bike" size={19} /></span>
                  <span className="grow">
                    <span className="list-row-title">{r.name}</span>
                    <span className="list-row-sub">
                      {r.destination || 'No destination'} · {dateTimeLabel(r.createdAt)}
                    </span>
                  </span>
                  {r.distanceKm > 0 && <Pill tone="muted">{r.distanceKm} km</Pill>}
                  <Icon name="chevronRight" size={17} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
