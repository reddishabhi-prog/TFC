import { useMemo, useState } from 'react'
import { Api } from '../services/api'
import { useAuth, useToast } from '../context/AppContext'
import { Button, Field, TextInput, Segmented, ChipGroup } from '../components/ui'
import { RiderPicker } from '../components/RiderPicker'
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

  const [tripEndDate, setTripEndDate] = useState('')
  const [plan, setPlan] = useState(null)
  const [days, setDays] = useState([])
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState('')
  const [warningDismissed, setWarningDismissed] = useState(false)

  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }))
  const everyone = [{ id: user.id, name: `${user.name} (you)`, avatarColor: user.avatarColor }, ...riders]

  const startDateMs = localMidnight(values.startsAt)
  const tripEndMs = dateInputToMs(tripEndDate)
  const isMultiDay = tripEndMs !== null && tripEndMs > startDateMs
  const selectedDays = isMultiDay ? Math.round((tripEndMs - startDateMs) / 86400000) + 1 : 0

  function clearPlan() { setPlan(null); setDays([]); setPlanError(''); setWarningDismissed(false) }

  async function planRoute() {
    if (!values.origin.trim() || !values.destination.trim()) {
      return setPlanError('Add a start location and destination first')
    }
    setPlanning(true); setPlanError('')
    try {
      const result = await Api.planRoute({
        origin: values.origin.trim(),
        destination: values.destination.trim(),
        startDate: startDateMs,
        endDate: tripEndMs,
      })
      setPlan(result)
      setDays(result.days)
      setWarningDismissed(false)
    } catch (e) {
      setPlanError(e.message || 'Could not plan that route right now')
    } finally { setPlanning(false) }
  }

  function updateDay(index, patch) {
    setDays((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)))
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
                         onChange={(e) => { set('origin', e.target.value); clearPlan() }} />
            </Field>
            <Field label="Destination" htmlFor="ride-to">
              <TextInput id="ride-to" placeholder="Coorg" value={values.destination}
                         onChange={(e) => { set('destination', e.target.value); clearPlan() }} />
            </Field>
            <Field label="Trip end date" htmlFor="ride-end-date"
                   hint="Only for multi-day trips — leave blank for a same-day ride">
              <input id="ride-end-date" type="date" className="input"
                     min={toDateInputValue(startDateMs)}
                     value={tripEndDate}
                     onChange={(e) => { setTripEndDate(e.target.value); clearPlan() }} />
            </Field>

            {isMultiDay && (
              <>
                <Button variant="ground" icon="map" loading={planning}
                        onClick={planRoute}>
                  {plan ? 'Re-plan this route' : `Plan this route — ${selectedDays} days`}
                </Button>
                {planError && (
                  <span className="field-error"><Icon name="alert" size={13} /> {planError}</span>
                )}
              </>
            )}
          </div>

          {plan && (
            <div className="card stack">
              <div className="section-title" style={{ margin: 0 }}>Trip plan</div>
              <p className="caption">
                {plan.origin.label} → {plan.destination.label} · {plan.distanceKm} km ·
                {' '}about {plan.drivingHours}h of riding · usually taken over{' '}
                {plan.recommendedDays}+ day{plan.recommendedDays === 1 ? '' : 's'}
              </p>

              {plan.tooShort && !warningDismissed && (
                <div className="trip-warning">
                  <div className="row" style={{ gap: 8 }}>
                    <Icon name="alert" size={16} />
                    <span className="strong">Only {plan.selectedDays} day{plan.selectedDays === 1 ? '' : 's'} picked</span>
                  </div>
                  <p className="caption" style={{ marginTop: 4 }}>
                    This route is usually ridden over {plan.recommendedDays}+ days — riders often want
                    more time for a trip like this. You can still go ahead with your own plan.
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setWarningDismissed(true)}>
                    Continue with {plan.selectedDays} days
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
                    <TextInput placeholder={`Day ${d.index} stop`} value={d.place || ''}
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
