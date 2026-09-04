import { useEffect, useRef, useState } from 'react'
import { Api } from '../services/api'
import { useAuth, useToast } from '../context/AppContext'
import { Button, ConfirmDialog, Avatar, Pill } from '../components/ui'
import { Icon } from '../components/Icon'
import { RideMap } from '../components/RideMap'
import { RideMemories } from '../components/RideMemories'
import { RideChecklist } from '../components/RideChecklist'
import { RideShareCard } from '../components/RideShareCard'
import { dateTimeLabel } from '../utils/format'

// How often we (a) read the device's own GPS and push it up, and (b) poll for
// everyone else's latest position. A few riders' worth of traffic doesn't
// need a websocket — polling this slowly is plenty smooth for a moving bike.
const LOCATION_PUSH_MS = 8000
const LOCATION_POLL_MS = 6000

export function RideScreen({ rideId, onBack, onOpenChat, onOpenSplit }) {
  const { user } = useAuth()
  const toast = useToast()
  const [ride, setRide] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sos, setSos] = useState('idle')
  const [view, setView] = useState('map')
  const [shareCard, setShareCard] = useState(false)

  useEffect(() => {
    let cancelled = false
    Api.ride(rideId)
      .then(({ ride: r }) => { if (!cancelled) setRide(r) })
      .catch((e) => { if (!cancelled) toast.error(e) })
    return () => { cancelled = true }
  }, [rideId, toast])

  // Poll everyone's latest position while the ride is on screen. Cheap and
  // simple beats a websocket for a handful of riders checking a map.
  useEffect(() => {
    if (!ride || ride.status === 'ended') return
    const timer = setInterval(() => {
      Api.ride(rideId).then(({ ride: r }) => setRide(r)).catch(() => { /* skip a beat, try again next tick */ })
    }, LOCATION_POLL_MS)
    return () => clearInterval(timer)
  }, [rideId, ride?.status])

  // Share this device's own GPS position while the ride is live. Paused/ended
  // rides, or a rider who never granted location permission, simply show
  // everyone else without a pin of their own.
  const deniedRef = useRef(false)
  useEffect(() => {
    if (!ride || ride.status !== 'live' || !('geolocation' in navigator)) return
    deniedRef.current = false
    function pushLocation() {
      if (deniedRef.current) return
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          Api.updateLocation(rideId, { lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(() => {})
        },
        (err) => { if (err.code === err.PERMISSION_DENIED) deniedRef.current = true },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 },
      )
    }
    pushLocation()
    const timer = setInterval(pushLocation, LOCATION_PUSH_MS)
    return () => clearInterval(timer)
  }, [rideId, ride?.status])

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

      <div className="segmented ride-view-toggle">
        <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>Map</button>
        <button className={view === 'checklist' ? 'on' : ''} onClick={() => setView('checklist')}>Checklist</button>
        <button className={view === 'memories' ? 'on' : ''} onClick={() => setView('memories')}>Memories</button>
      </div>

      {view === 'map' ? (
        <div className="ride-map">
          <RideMap members={ride.members} youId={user.id} />

          {(ride.origin || ride.destination) && (
            <div className="route-banner">
              {ride.origin || 'Start'} <Icon name="arrowLeft" size={12} style={{ transform: 'rotate(180deg)' }} /> {ride.destination || 'Finish'}
            </div>
          )}

          {!ride.members.some((m) => typeof m.lat === 'number') && (
            <div className="map-hint">Waiting for riders to share their location…</div>
          )}

          {!ended && (
            sos === 'sent'
              ? <div className="sos-sent">🆘 SOS sent</div>
              : <button className="sos-btn" onClick={() => setConfirm({ kind: 'sos' })}>SOS</button>
          )}
        </div>
      ) : view === 'checklist' ? (
        <RideChecklist ride={ride} />
      ) : (
        <RideMemories ride={ride} onRideUpdated={setRide} />
      )}

      {view === 'map' && (
        <div className="ride-sheet">
          <button className="join-code" onClick={copyCode} aria-label={`Copy join code ${ride.joinCode}`}>
            <span className="join-code-value mono">{ride.joinCode}</span>
            <span className="join-code-hint">{copied ? 'Copied ✓' : 'Tap to copy · share with riders'}</span>
            <Icon name="copy" size={17} />
          </button>

          {ended && (
            <Button variant="primary" size="lg" block icon="trophy"
                    style={{ marginTop: 'var(--sp-3)' }} onClick={() => setShareCard(true)}>
              Share your ride card
            </Button>
          )}

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
      )}

      <ConfirmDialog
        open={confirm?.kind === 'end'}
        title="End this ride?"
        body="Tracking stops for everyone and the ride summary is generated. This can't be undone."
        confirmLabel="End ride"
        cancelLabel="Keep riding"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await update({ status: 'ended' }, 'Ride ended')
          setShareCard(true) // peak moment to share is right when it wraps up
        }}
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

      {shareCard && <RideShareCard ride={ride} onClose={() => setShareCard(false)} />}
    </div>
  )
}
