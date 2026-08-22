import { useEffect, useState } from 'react'
import { Api } from '../services/api'
import { useAuth, useToast } from '../context/AppContext'
import { Button, ConfirmDialog, Avatar, Pill } from '../components/ui'
import { Icon } from '../components/Icon'
import { dateTimeLabel } from '../utils/format'

// One shared bezier every rider travels along, so the map reads as a convoy on
// a single road rather than scattered dots.
const ROUTE = { p0: [12, 86], c1: [88, 72], c2: [10, 34], p3: [88, 10] }
const ROUTE_D = `M ${ROUTE.p0[0]} ${ROUTE.p0[1]} C ${ROUTE.c1[0]} ${ROUTE.c1[1]}, ${ROUTE.c2[0]} ${ROUTE.c2[1]}, ${ROUTE.p3[0]} ${ROUTE.p3[1]}`

function routePoint(progress) {
  const t = Math.min(1, Math.max(0, progress / 100))
  const u = 1 - t
  const { p0, c1, c2, p3 } = ROUTE
  return [
    u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p3[0],
    u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p3[1],
  ]
}
function routeTangent(progress) {
  const t = Math.min(1, Math.max(0, progress / 100))
  const u = 1 - t
  const { p0, c1, c2, p3 } = ROUTE
  const dx = 3 * u * u * (c1[0] - p0[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (p3[0] - c2[0])
  const dy = 3 * u * u * (c1[1] - p0[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (p3[1] - c2[1])
  const len = Math.hypot(dx, dy) || 1
  return [dx / len, dy / len]
}
/**
 * Riders all start at 0% progress, so without an offset every marker lands on
 * the same point and only the last one drawn is visible. Fan them out
 * perpendicular to the road: lane 0 stays on the line, the rest alternate.
 */
function laneOffset(lane) {
  if (!lane) return 0
  const step = Math.ceil(lane / 2)
  return lane % 2 === 1 ? step : -step
}
function ridePoint(progress, lane) {
  const [x, y] = routePoint(progress)
  const [tx, ty] = routeTangent(progress)
  const offset = laneOffset(lane) * 13
  return [
    Math.min(94, Math.max(6, x + -ty * offset)),
    Math.min(94, Math.max(6, y + tx * offset)),
  ]
}

export function RideScreen({ rideId, onBack, onOpenChat, onOpenSplit }) {
  const { user } = useAuth()
  const toast = useToast()
  const [ride, setRide] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sos, setSos] = useState('idle')

  useEffect(() => {
    let cancelled = false
    Api.rides()
      .then(({ rides }) => { if (!cancelled) setRide(rides.find((r) => r.id === rideId) ?? null) })
      .catch((e) => { if (!cancelled) toast.error(e) })
    return () => { cancelled = true }
  }, [rideId, toast])

  async function update(patch, message) {
    setBusy(true)
    try {
      const { ride: updated } = await Api.updateRide(rideId, patch)
      setRide(updated)
      if (message) toast.success(message)
      setConfirm(null)
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  async function copyCode() {
    try { await navigator.clipboard?.writeText(ride.joinCode) } catch { /* clipboard may be blocked */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!ride) {
    return (
      <div className="screen screen-enter">
        <header className="app-bar">
          <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="arrowLeft" /></button>
          <div className="app-bar-title"><div className="app-bar-title-1">Ride</div></div>
        </header>
        <div className="screen-scroll pad"><div className="skeleton" style={{ height: 220, borderRadius: 18 }} /></div>
      </div>
    )
  }

  const ended = ride.status === 'ended'

  return (
    <div className="screen screen-enter">
      <header className="app-bar on-ground">
        <button className="icon-btn on-ground" onClick={onBack} aria-label="Back"><Icon name="arrowLeft" /></button>
        <div className="app-bar-title">
          <div className="app-bar-title-1">{ride.name}</div>
          <div className="app-bar-title-2">
            {ended ? 'Finished' : ride.status === 'paused' ? 'Paused' : 'Live'} · {ride.members.length} riders
          </div>
        </div>
        <button className="icon-btn on-ground" onClick={() => onOpenChat(ride.id)} aria-label="Ride chat">
          <Icon name="chat" />
        </button>
      </header>

      <div className="ride-map">
        <svg className="road-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={ROUTE_D} fill="none" stroke="#3a1f26" strokeWidth="7" strokeLinecap="round" />
          <path d={ROUTE_D} fill="none" stroke="#ffb84d" strokeWidth="1.2" strokeDasharray="3 2.4"
                strokeLinecap="round" opacity="0.9" />
          <circle cx={ROUTE.p0[0]} cy={ROUTE.p0[1]} r="2" fill="#ffb84d" />
          <circle cx={ROUTE.p3[0]} cy={ROUTE.p3[1]} r="2.6" fill="none" stroke="#ffb84d" strokeWidth="1" />
        </svg>
        <div className="route-flag start" style={{ left: `${ROUTE.p0[0]}%`, top: `${ROUTE.p0[1]}%` }}>
          {ride.origin || 'Start'}
        </div>
        <div className="route-flag" style={{ left: `${ROUTE.p3[0]}%`, top: `${ROUTE.p3[1]}%` }}>
          🏁 {ride.destination || 'Finish'}
        </div>

        {ride.members.map((m, i) => {
          const [x, y] = ridePoint(0, i)
          return (
            <div className="rider-marker" key={m.id} style={{ left: `${x}%`, top: `${y}%` }}>
              <Avatar name={m.name} color={m.id === user.id ? '#ffb84d' : m.avatarColor} size="sm" />
            </div>
          )
        })}

        {!ended && (
          sos === 'sent'
            ? <div className="sos-sent">🆘 SOS sent</div>
            : <button className="sos-btn" onClick={() => setConfirm({ kind: 'sos' })}>SOS</button>
        )}
      </div>

      <div className="ride-sheet">
        <button className="join-code" onClick={copyCode} aria-label={`Copy join code ${ride.joinCode}`}>
          <span className="join-code-value mono">{ride.joinCode}</span>
          <span className="join-code-hint">{copied ? 'Copied ✓' : 'Tap to copy · share with riders'}</span>
          <Icon name="copy" size={17} />
        </button>

        <div className="row" style={{ gap: 8, marginTop: 'var(--sp-3)' }}>
          <Button block icon="split" onClick={() => onOpenSplit(ride.groupId)}>Split</Button>
          {!ended && (
            <>
              <Button block icon={ride.status === 'paused' ? 'play' : 'pause'} loading={busy}
                      onClick={() => update({ status: ride.status === 'paused' ? 'live' : 'paused' })}>
                {ride.status === 'paused' ? 'Resume' : 'Pause'}
              </Button>
              <Button variant="primary" block icon="stop"
                      onClick={() => setConfirm({ kind: 'end' })}>End</Button>
            </>
          )}
        </div>

        <div className="section" style={{ padding: 'var(--sp-5) 0 0' }}>
          <div className="section-title">Riders</div>
          <div className="stack" style={{ gap: 6 }}>
            {ride.members.map((m) => (
              <div className="list-row" key={m.id}>
                <Avatar name={m.name} color={m.avatarColor} size="sm" />
                <span className="grow">
                  <span className="list-row-title">
                    {m.name}{m.id === user.id ? ' (you)' : ''}
                  </span>
                  <span className="list-row-sub">{dateTimeLabel(ride.startsAt)}</span>
                </span>
                {m.id === ride.leaderId && <Pill tone="brand">Leader</Pill>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm?.kind === 'end'}
        title="End this ride?"
        body="Tracking stops for everyone and the ride summary is generated. This can't be undone."
        confirmLabel="End ride"
        cancelLabel="Keep riding"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => update({ status: 'ended' }, 'Ride ended')}
      />
      <ConfirmDialog
        open={confirm?.kind === 'sos'}
        title="Send SOS?"
        body="Your live location is shared with the group and your emergency contact immediately."
        confirmLabel="Send SOS"
        variant="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setSos('sent'); setConfirm(null); toast.error('SOS broadcast to your group') }}
      />
    </div>
  )
}
