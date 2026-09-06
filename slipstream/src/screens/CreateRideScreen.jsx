import { useEffect, useMemo, useState } from 'react'
import { Api } from '../services/api'
import { useAuth, useToast } from '../context/AppContext'
import { Button, Field, TextInput, Segmented, ChipGroup } from '../components/ui'
import { RiderPicker } from '../components/RiderPicker'
import { RoutePicker } from '../components/RoutePicker'
import { Icon } from '../components/Icon'
import { dateTimeLabel, dayLabel, toLocalInput, fromLocalInput, durationLabel } from '../utils/format'

/** Local midnight for a date-only comparison against a datetime-local value. */
function localMidnight(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const toDateInputValue = (ms) => {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const dateInputToMs = (str) => {
  if (!str) return null
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

/** Presets cover almost every real ride; the exact picker is there for the rest. */
function presetTimes() {
  const now = new Date()
  const at = (dayOffset, hour, minute = 0) => {
    const d = new Date(now)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hour, minute, 0, 0)
    return d.getTime()
  }
  const daysUntilSaturday = (6 - now.getDay() + 7) % 7 || 7
  return [
    { value: Date.now() + 60 * 60 * 1000, label: 'In an hour' },
    { value: at(0, 18), label: 'This evening' },
    { value: at(1, 7), label: 'Tomorrow 7 AM' },
    { value: at(daysUntilSaturday, 6, 30), label: 'Saturday 6:30 AM' },
  ]
}

const DURATIONS = [
  { value: 2, label: '2 hrs' },
  { value: 4, label: '4 hrs' },
  { value: 6, label: '6 hrs' },
  { value: 10, label: 'Full day' },
  { value: 48, label: 'Multi-day' },
]

export function CreateRideScreen({ onCancel, onCreated }) {
  const { user } = useAuth()
  const toast = useToast()
  const presets = useMemo(presetTimes, [])

  const [values, setValues] = useState({
    name: '', description: '', origin: '', destination: '',
    startsAt: presets[0].value, durationHrs: 6, visibility: 'private',
  })
  const [riders, setRiders] = useState([])
  const [leaderId, setLeaderId] = useState(user.id)
  const [showExact, setShowExact] = useState(false)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  // The route picker: every alternative OSRM found between origin and
  // destination, drawn on a map so the leader — not the routing engine —
  // decides which road this trip actually follows.
  const [routeResult, setRouteResult] = useState(null)
  const [routeIndex, setRouteIndex] = useState(0)
  const [findingRoutes, setFindingRoutes] = useState(false)
  const [routeError, setRouteError] = useState('')
  const selectedRoute = routeResult?.routes[routeIndex] ?? null

  // The day-by-day plan. Slots are the leader's own to fill in — nothing here
  // ever invents a stop name — weather is the only thing a lookup can add.
  const [tripEndDate, setTripEndDate] = useState('')
  const [days, setDays] = useState([])
  const [tripInfo, setTripInfo] = useState(null)
  const [checkingWeather, setCheckingWeather] = useState(false)
  const [weatherError, setWeatherError] = useState('')
  const [warningDismissed, setWarningDismissed] = useState(false)

  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }))
  const everyone = [{ id: user.id, name: `${user.name} (you)`, avatarColor: user.avatarColor }, ...riders]

  const startDateMs = localMidnight(values.startsAt)
  const tripEndMs = dateInputToMs(tripEndDate)
  const isMultiDay = tripEndMs !== null && tripEndMs > startDateMs
  const selectedDays = isMultiDay ? Math.round((tripEndMs - startDateMs) / 86400000) + 1 : 0

  function clearRoute() { setRouteResult(null); setRouteIndex(0); setRouteError(''); setTripInfo(null) }

  async function findRoutes() {
    if (!values.origin.trim() || !values.destination.trim()) {
      return setRouteError('Add a start location and destination first')
    }
    setFindingRoutes(true); setRouteError('')
    try {
      const result = await Api.routeOptions({ origin: values.origin.trim(), destination: values.destination.trim() })
      setRouteResult(result)
      setRouteIndex(0)
      setTripInfo(null)
    } catch (e) {
      setRouteResult(null)
      setRouteError(e.message || 'Could not find routes right now')
    } finally {
      setFindingRoutes(false)
    }
  }

  // As soon as an end date makes this a multi-day trip, the leader gets one
  // slot per day to fill in themselves — no place names are ever guessed.
  // Existing place/notes survive when the day count changes; only the count
  // and dates adjust.
  useEffect(() => {
    if (!isMultiDay) { setDays([]); return }
    setDays((prev) => Array.from({ length: selectedDays }, (_, i) => {
      const date = startDateMs + i * 86400000
      return prev[i] ? { ...prev[i], date } : { index: i + 1, date, place: '', notes: '', weather: null }
    }))
  }, [isMultiDay, selectedDays, startDateMs])

  function updateDay(index, patch) {
    setDays((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  async function checkWeather() {
    if (!selectedRoute) return
    setCheckingWeather(true); setWeatherError('')
    try {
      const result = await Api.planRoute({
        startDate: startDateMs,
        endDate: tripEndMs,
        distanceKm: selectedRoute.distanceKm,
        durationHours: selectedRoute.durationHours,
        points: selectedRoute.points,
      })
      setTripInfo(result)
      setDays((prev) => prev.map((d, i) => ({ ...d, weather: result.days[i]?.weather ?? d.weather })))
      setWarningDismissed(false)
    } catch (e) {
      setWeatherError(e.message || 'Could not check the weather right now')
    } finally {
      setCheckingWeather(false)
    }
  }

  async function submit() {
    const next = {}
    if (!values.name.trim()) next.name = 'Give the ride a name'
    if (Object.keys(next).length) return setErrors(next)

    setBusy(true); setErrors({})
    try {
      const { ride } = await Api.createRide({
        ...values,
        name: values.name.trim(),
        memberIds: riders.map((r) => r.id),
        leaderId,
        tripEndsAt: isMultiDay ? tripEndMs : null,
        days: isMultiDay ? days : [],
        routePoints: selectedRoute?.points ?? null,
      })
      toast.success('Ride is live — share the join code')
      onCreated(ride)
    } catch (e) {
      setErrors(e.errors || {})
      if (!e.field && !e.errors) toast.error(e)
    } finally { setBusy(false) }
  }

  return (
    <div className="screen screen-enter">
      <header className="app-bar on-ground">
        <button className="icon-btn on-ground" onClick={onCancel} aria-label="Cancel">
          <Icon name="close" />
        </button>
        <div className="app-bar-title">
          <div className="app-bar-title-1">New ride</div>
          <div className="app-bar-title-2">Plan it, invite the pack</div>
        </div>
      </header>

      <div className="screen-scroll pad" style={{ paddingTop: 'var(--sp-4)' }}>
        <div className="stack-lg">
          <div className="card stack">
            <Field label="Ride name" htmlFor="ride-name" error={errors.name} required>
              <TextInput id="ride-name" placeholder="Weekend Ghats Run" value={values.name}
                         error={errors.name} autoFocus
                         onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Description" htmlFor="ride-desc">
              <textarea id="ride-desc" className="input" rows={2}
                        placeholder="Meetup point, pace, breakfast stop…"
                        value={values.description}
                        onChange={(e) => set('description', e.target.value)} />
            </Field>
          </div>

          <div className="card stack">
            <div className="field-label">When does it start?</div>
            <ChipGroup
              label="Start time"
              options={presets.map((p) => ({ value: p.value, label: p.label }))}
              value={values.startsAt}
              onChange={(v) => { set('startsAt', v); setShowExact(false) }}
            />
            <button className="link-btn" onClick={() => setShowExact((v) => !v)}>
              <Icon name="calendar" size={15} />
              {showExact ? 'Use a preset instead' : 'Pick an exact date & time'}
            </button>
            {showExact && (
              <input
                className="input" type="datetime-local"
                value={toLocalInput(values.startsAt)}
                onChange={(e) => set('startsAt', fromLocalInput(e.target.value))}
              />
            )}
            <div className="when-summary">
              <Icon name="clock" size={15} />
              Rolls out <strong>{dateTimeLabel(values.startsAt)}</strong>
            </div>

            <div className="field-label" style={{ marginTop: 'var(--sp-2)' }}>How long?</div>
            <ChipGroup label="Duration" options={DURATIONS} value={values.durationHrs}
                       onChange={(v) => set('durationHrs', v)} />
            <div className="when-summary">
              <Icon name="trophy" size={15} />
              Wraps up <strong>{dateTimeLabel(values.startsAt + values.durationHrs * 3600000)}</strong>
              {' · '}{durationLabel(values.durationHrs)}
            </div>
          </div>

          <div className="card stack">
            <div className="section-title" style={{ margin: 0 }}>Route</div>
            <Field label="Start location" htmlFor="ride-from">
              <TextInput id="ride-from" placeholder="Bengaluru" value={values.origin}
                         onChange={(e) => { set('origin', e.target.value); clearRoute() }} />
            </Field>
            <Field label="Destination" htmlFor="ride-to">
              <TextInput id="ride-to" placeholder="Coorg" value={values.destination}
                         onChange={(e) => { set('destination', e.target.value); clearRoute() }} />
            </Field>

            <Button variant="ground" icon="map" loading={findingRoutes} onClick={findRoutes}>
              {routeResult ? 'Find routes again' : 'Find routes'}
            </Button>
            {routeError && <span className="field-error"><Icon name="alert" size={13} /> {routeError}</span>}

            {routeResult && (
              <>
                <p className="caption">
                  {routeResult.origin.label} → {routeResult.destination.label} · there's more than one way to
                  get there — pick the road this trip actually follows.
                </p>
                <RoutePicker
                  origin={routeResult.origin} destination={routeResult.destination}
                  routes={routeResult.routes} selected={routeIndex}
                  onSelect={(i) => { setRouteIndex(i); setTripInfo(null) }}
                />
              </>
            )}

            <Field label="Trip end date" htmlFor="ride-end-date"
                   hint="Only for multi-day trips — leave blank for a same-day ride">
              <input id="ride-end-date" type="date" className="input"
                     min={toDateInputValue(startDateMs)}
                     value={tripEndDate}
                     onChange={(e) => setTripEndDate(e.target.value)} />
            </Field>
          </div>

          {isMultiDay && (
            <div className="card stack">
              <div className="row-between">
                <div className="section-title" style={{ margin: 0 }}>
                  {selectedDays}-day plan
                </div>
                <Button variant="ghost" size="sm" icon="sun" loading={checkingWeather}
                        disabled={!selectedRoute} onClick={checkWeather}>
                  Check weather
                </Button>
              </div>
              {!selectedRoute && (
                <p className="caption">Find and pick a route above to check the weather for these dates.</p>
              )}
              {weatherError && <span className="field-error"><Icon name="alert" size={13} /> {weatherError}</span>}

              {tripInfo && (
                <p className="caption">
                  {tripInfo.distanceKm} km · about {tripInfo.drivingHours}h of riding · usually taken over{' '}
                  {tripInfo.recommendedDays}+ day{tripInfo.recommendedDays === 1 ? '' : 's'}
                </p>
              )}
              {tripInfo?.tooShort && !warningDismissed && (
                <div className="trip-warning">
                  <div className="row" style={{ gap: 8 }}>
                    <Icon name="alert" size={16} />
                    <span className="strong">Only {tripInfo.selectedDays} day{tripInfo.selectedDays === 1 ? '' : 's'} picked</span>
                  </div>
                  <p className="caption" style={{ marginTop: 4 }}>
                    This route is usually ridden over {tripInfo.recommendedDays}+ days — riders often want
                    more time for a trip like this. You can still go ahead with your own plan.
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setWarningDismissed(true)}>
                    Continue with {tripInfo.selectedDays} days
                  </Button>
                </div>
              )}

              <div className="stack" style={{ gap: 10 }}>
                {days.map((d, i) => (
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
                    <TextInput placeholder={`Where are you stopping on day ${d.index}?`} value={d.place || ''}
                               style={{ marginTop: 8 }}
                               onChange={(e) => updateDay(i, { place: e.target.value })} />
                    <textarea className="input" rows={2} style={{ marginTop: 8 }}
                              placeholder="Notes for this day — fuel stops, road conditions, where you'll stay…"
                              value={d.notes || ''}
                              onChange={(e) => updateDay(i, { notes: e.target.value })} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card stack">
            <div className="section-title" style={{ margin: 0 }}>Visibility</div>
            <Segmented
              label="Who can join"
              value={values.visibility}
              onChange={(v) => set('visibility', v)}
              options={[
                { value: 'private', label: 'Private' },
                { value: 'invite', label: 'Invite only' },
                { value: 'public', label: 'Public' },
              ]}
            />
            <p className="caption">
              {values.visibility === 'private' && 'Only riders with the join code can hop on.'}
              {values.visibility === 'invite' && 'Invited riders can join without a code.'}
              {values.visibility === 'public' && 'Listed under Upcoming rides for the community.'}
            </p>
          </div>

          <div className="card stack">
            <div className="section-title" style={{ margin: 0 }}>Who's riding?</div>
            <RiderPicker
              selected={everyone}
              leaderId={leaderId}
              onMakeLeader={setLeaderId}
              onAdd={(r) => setRiders((list) => [...list, r])}
              onRemove={(id) => {
                if (id === user.id) return
                setRiders((list) => list.filter((r) => r.id !== id))
                if (leaderId === id) setLeaderId(user.id)
              }}
            />
          </div>

          <Button variant="primary" size="lg" block loading={busy}
                  disabled={!values.name.trim()} onClick={submit}>
            Start the ride
          </Button>
        </div>
      </div>
    </div>
  )
}
