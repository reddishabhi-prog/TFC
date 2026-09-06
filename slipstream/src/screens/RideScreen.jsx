import { useEffect, useRef, useState } from 'react'
import { Api } from '../services/api'
import { useAuth, useToast } from '../context/AppContext'
import { Button, ConfirmDialog, Avatar, Pill, Sheet, ChipGroup, TextInput } from '../components/ui'
import { Icon } from '../components/Icon'
import { RideMap } from '../components/RideMap'
import { RideMemories } from '../components/RideMemories'
import { RideChecklist } from '../components/RideChecklist'
import { RideItinerary } from '../components/RideItinerary'
import { RideShareCard } from '../components/RideShareCard'
import { dateTimeLabel } from '../utils/format'

// How often we (a) read the device's own GPS and push it up, and (b) poll for
// everyone else's latest position. A few riders' worth of traffic doesn't
// need a websocket — polling this slowly is plenty smooth for a moving bike.
const LOCATION_PUSH_MS = 8000
const LOCATION_POLL_MS = 6000

const STOP_KINDS = [
  { value: 'fuel', label: 'Fuel', icon: '⛽' },
  { value: 'food', label: 'Food', icon: '🍽️' },
  { value: 'rest', label: 'Rest', icon: '☕' },
  { value: 'other', label: 'Other', icon: '📍' },
]

export function RideScreen({ rideId, onBack, onOpenChat, onOpenSplit }) {
  const { user } = useAuth()
  const toast = useToast()
  const [ride, setRide] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sos, setSos] = useState('idle')
  const [sosBusy, setSosBusy] = useState(false)
  const [view, setView] = useState('map')
  const [shareCard, setShareCard] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [addingStop, setAddingStop] = useState(false)
  const [stopKind, setStopKind] = useState('fuel')
  const [stopLabel, setStopLabel] = useState('')
  const [stopBusy, setStopBusy] = useState(false)
  const mapRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    Api.ride(rideId)
      .then(({ ride: r }) => { if (!cancelled) setRide(r) })
      .catch((e) => { if (!cancelled) toast.error(e) })
    return () => { cancelled = true }
  }, [rideId, toast])

  // Poll everyone's latest position while the ride is on screen. Cheap and
  // simple beats a websocket for a handful of riders checking a map — but
  // only while the tab is actually visible. Nobody's watching the map while
  // it's backgrounded, so there's no reason to keep spending battery and
  // data polling it; a fresh fetch on return catches it straight back up.
  useEffect(() => {
    if (!ride || ride.status === 'ended') return
    const poll = () => {
      Api.ride(rideId).then(({ ride: r }) => setRide(r)).catch(() => { /* skip a beat, try again next tick */ })
    }
    const timer = setInterval(() => { if (!document.hidden) poll() }, LOCATION_POLL_MS)
    const onVisible = () => { if (!document.hidden) poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [rideId, ride?.status])

  // Share this device's own GPS position while the ride is live. Paused/ended
  // rides, or a rider who never granted location permission, simply show
  // everyone else without a pin of their own.
  //
  // A read that fails to reach the server (a highway dead zone) is queued
  // rather than dropped, and sent along with the next successful push — so a
  // few minutes of bad signal costs a delayed update, not a gap in the
  // breadcrumb trail the eventual share card draws from.
  const deniedRef = useRef(false)
  const pendingRef = useRef([])
  useEffect(() => {
    if (!ride || ride.status !== 'live' || !('geolocation' in navigator)) return
    deniedRef.current = false
    function pushLocation() {
      if (deniedRef.current) return
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const point = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() }
          const batch = [...pendingRef.current, point].slice(-30)
          Api.updateLocation(rideId, { points: batch })
            .then(() => { pendingRef.current = [] })
            .catch(() => { pendingRef.current = batch })
        },
        (err) => { if (err.code === err.PERMISSION_DENIED) deniedRef.current = true },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 },
      )
    }
    pushLocation()
    const timer = setInterval(pushLocation, LOCATION_PUSH_MS)
    // Retry sooner than the next scheduled tick the moment the browser
    // itself reports the connection is back, instead of leaving a queued
    // backlog sitting for up to LOCATION_PUSH_MS after reconnecting.
    window.addEventListener('online', pushLocation)
    return () => { clearInterval(timer); window.removeEventListener('online', pushLocation) }
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

  function addStop() {
    if (!('geolocation' in navigator)) return toast.error("This device can't share a location")
    setStopBusy(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { ride: updated } = await Api.addStop(rideId, {
            kind: stopKind,
            label: stopLabel.trim(),
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          })
          setRide(updated)
          toast.success('Pit stop added')
          setAddingStop(false)
          setStopLabel('')
        } catch (e) {
          toast.error(e)
        } finally {
          setStopBusy(false)
        }
      },
      () => { toast.error('Could not get your location'); setStopBusy(false) },
      { enableHighAccuracy: true, timeout: 8000 },
    )
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
        {ride.days.length > 0 && (
          <button className={view === 'plan' ? 'on' : ''} onClick={() => setView('plan')}>Plan</button>
        )}
        <button className={view === 'memories' ? 'on' : ''} onClick={() => setView('memories')}>Memories</button>
      </div>

      {view === 'map' ? (
        <div className="ride-map-view">
          <div className={`ride-map ${sheetOpen ? 'sheet-expanded' : ''}`}>
            <RideMap ref={mapRef} members={ride.members} youId={user.id} routePoints={ride.routePoints}
                     stops={ride.stops} days={ride.days} />

            {(ride.origin || ride.destination) && (
              <div className="route-banner">
                {ride.origin || 'Start'} <Icon name="arrowLeft" size={12} style={{ transform: 'rotate(180deg)' }} /> {ride.destination || 'Finish'}
              </div>
            )}

            {!ride.members.some((m) => typeof m.lat === 'number') && (
              <div className="map-hint">Waiting for riders to share their location…</div>
            )}

            {ride.members.some((m) => typeof m.lat === 'number') && (
              <button className="map-recenter" onClick={() => mapRef.current?.recenter()} aria-label="Recenter on the group">
                <Icon name="locate" size={19} />
              </button>
            )}

            {!ended && (
              <button className="pit-stop-btn" onClick={() => setAddingStop(true)} aria-label="Add a pit stop">
                <Icon name="fuel" size={19} />
              </button>
            )}

            {!ended && (
              sos === 'sent'
                ? <div className="sos-sent">🆘 SOS sent</div>
                : <button className="sos-btn" onClick={() => setConfirm({ kind: 'sos' })}>SOS</button>
            )}
          </div>

          <div className={`ride-sheet ${sheetOpen ? 'expanded' : ''}`}>
            <button className="ride-sheet-handle" onClick={() => setSheetOpen((v) => !v)}
                    aria-expanded={sheetOpen} aria-label={sheetOpen ? 'Collapse ride details' : 'Expand ride details'}>
              <span className="ride-sheet-handle-bar" />
            </button>

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
        </div>
      ) : view === 'checklist' ? (
        <RideChecklist ride={ride} />
      ) : view === 'plan' && ride.days.length > 0 ? (
        <RideItinerary ride={ride} />
      ) : (
        <RideMemories ride={ride} onRideUpdated={setRide} />
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
        body="Every other rider on this ride gets an immediate notification with your name and the ride."
        confirmLabel="Send SOS"
        variant="danger"
        busy={sosBusy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setSosBusy(true)
          try {
            await Api.sendSos(rideId)
            setSos('sent')
            setConfirm(null)
            toast.error('SOS broadcast to your group')
          } catch (e) {
            toast.error(e)
          } finally {
            setSosBusy(false)
          }
        }}
      />

      <Sheet open={addingStop} onClose={() => setAddingStop(false)} title="Add a pit stop">
        <div className="stack">
          <ChipGroup label="Type" options={STOP_KINDS} value={stopKind} onChange={setStopKind} />
          <TextInput placeholder="Optional note — e.g. HP petrol pump" value={stopLabel}
                     onChange={(e) => setStopLabel(e.target.value)} />
          <Button variant="primary" block loading={stopBusy} onClick={addStop}>
            Drop a pin at my location
          </Button>
        </div>
      </Sheet>

      {shareCard && <RideShareCard ride={ride} onClose={() => setShareCard(false)} />}
    </div>
  )
}
