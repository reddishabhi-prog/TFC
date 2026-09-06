import { useEffect, useMemo, useState } from 'react'
import { Api } from '../services/api'
import { useToast } from '../context/AppContext'
import { Button, Field, TextInput, EmptyState, SkeletonList, Sheet, ConfirmDialog, Pill } from '../components/ui'
import { Icon } from '../components/Icon'
import { validateName, validateOdometer, validateRegNo } from '../utils/validate'
import { toLocalInput } from '../utils/format'

const DAY = 86400000
const toDateInput = (ts) => (ts ? toLocalInput(ts).slice(0, 10) : '')

/** Documents inside 30 days are "due soon"; past their date they're overdue. */
function docStatus(ts) {
  if (!ts) return null
  const days = Math.ceil((ts - Date.now()) / DAY)
  if (days < 0) return { tone: 'danger', label: `Overdue by ${Math.abs(days)}d` }
  if (days <= 30) return { tone: 'warning', label: `Due in ${days}d` }
  return { tone: 'success', label: 'Valid' }
}

export function GarageScreen({ onBack }) {
  const toast = useToast()
  const [vehicles, setVehicles] = useState(null)
  const [sheet, setSheet] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Api.vehicles().then((r) => setVehicles(r.vehicles)).catch(() => setVehicles([]))
  }, [])

  const dueCount = useMemo(() => (vehicles ?? []).reduce((n, v) => {
    for (const ts of [v.insuranceDue, v.pucDue, v.serviceDue]) {
      const s = docStatus(ts)
      if (s && s.tone !== 'success') n += 1
    }
    return n
  }, 0), [vehicles])

  async function remove(vehicle) {
    setBusy(true)
    try {
      await Api.deleteVehicle(vehicle.id)
      setVehicles((list) => list.filter((v) => v.id !== vehicle.id))
      toast.success('Vehicle removed')
      setConfirm(null)
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  return (
    <div className="screen screen-enter">
      <header className="app-bar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="arrowLeft" /></button>
        <div className="app-bar-title">
          <div className="app-bar-title-1">Bike garage</div>
          <div className="app-bar-title-2">
            {vehicles === null ? 'Loading…' : `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`}
          </div>
        </div>
        {/* Single add affordance in the header — the empty state's button is
            the same action, shown only when there is nothing else on screen. */}
        {vehicles?.length > 0 && (
          <Button variant="primary" size="sm" icon="plus"
                  onClick={() => { setEditing(null); setSheet(true) }}>Add</Button>
        )}
      </header>

      <div className="screen-scroll">
        {vehicles === null ? (
          <div className="pad"><SkeletonList rows={2} /></div>
        ) : vehicles.length === 0 ? (
          <EmptyState
            icon="🏍️"
            title="No vehicles yet"
            body="Add your bike to track insurance, PUC and service reminders in one place."
            action={<Button variant="primary" icon="plus" onClick={() => { setEditing(null); setSheet(true) }}>
              Add a vehicle
            </Button>}
          />
        ) : (
          <>
            <div className="pad">
              <div className="hero-card">
                <div className="hero-eyebrow">Fleet overview</div>
                <div className="garage-stats">
                  <div>
                    <div className="stat-value">{vehicles.length}</div>
                    <div className="stat-label">Vehicles</div>
                  </div>
                  <div>
                    <div className="stat-value">{dueCount}</div>
                    <div className="stat-label">Reminders due</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="section">
              <div className="stack">
                {vehicles.map((v) => (
                  <div className="vehicle-card" key={v.id}>
                    <div className="row-between">
                      <div className="row" style={{ gap: 10 }}>
                        <span className="list-row-icon"><Icon name="bike" size={19} /></span>
                        <span>
                          <div className="list-row-title">{v.nickname}</div>
                          <div className="list-row-sub">
                            {[v.brand, v.model].filter(Boolean).join(' ') || 'No model set'}
                            {v.regNo ? ` · ${v.regNo}` : ''}
                          </div>
                        </span>
                      </div>
                      <div className="row" style={{ gap: 0 }}>
                        <button className="icon-btn" aria-label={`Edit ${v.nickname}`}
                                onClick={() => { setEditing(v); setSheet(true) }}>
                          <Icon name="edit" size={16} />
                        </button>
                        <button className="icon-btn" aria-label={`Delete ${v.nickname}`}
                                onClick={() => setConfirm(v)}>
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="doc-row">
                      {[
                        ['Insurance', v.insuranceDue],
                        ['PUC', v.pucDue],
                        ['Service', v.serviceDue],
                      ].map(([label, ts]) => {
                        const s = docStatus(ts)
                        return (
                          <div className="doc-chip" key={label}>
                            <span className="doc-label">{label}</span>
                            {s ? <Pill tone={s.tone}>{s.label}</Pill> : <span className="caption">Not set</span>}
                          </div>
                        )
                      })}
                    </div>
                    {v.odometerKm != null && (
                      <div className="caption" style={{ marginTop: 'var(--sp-2)' }}>
                        Odometer · <span className="num">{v.odometerKm.toLocaleString('en-IN')} km</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <Sheet open={sheet} onClose={() => setSheet(false)} title={editing ? 'Edit vehicle' : 'Add a vehicle'}>
        <VehicleForm
          vehicle={editing}
          onCancel={() => setSheet(false)}
          onSaved={(v) => {
            setVehicles((list) => (editing ? list.map((x) => (x.id === v.id ? v : x)) : [v, ...list]))
            setSheet(false); setEditing(null)
          }}
        />
      </Sheet>

      <ConfirmDialog
        open={!!confirm}
        title={`Remove ${confirm?.nickname}?`}
        body="Its reminders and details will be deleted."
        confirmLabel="Remove"
        variant="danger"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => remove(confirm)}
      />
    </div>
  )
}

function VehicleForm({ vehicle, onSaved, onCancel }) {
  const toast = useToast()
  const [values, setValues] = useState(() => ({
    nickname: vehicle?.nickname ?? '',
    brand: vehicle?.brand ?? '',
    model: vehicle?.model ?? '',
    regNo: vehicle?.regNo ?? '',
    odometerKm: vehicle?.odometerKm != null ? String(vehicle.odometerKm) : '',
    insuranceDue: toDateInput(vehicle?.insuranceDue),
    pucDue: toDateInput(vehicle?.pucDue),
    serviceDue: toDateInput(vehicle?.serviceDue),
  }))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }))

  async function submit() {
    const next = {}
    const nameError = validateName(values.nickname, { field: 'Nickname' })
    if (nameError) next.nickname = nameError
    const odoError = validateOdometer(values.odometerKm)
    if (odoError) next.odometerKm = odoError
    const regError = validateRegNo(values.regNo)
    if (regError) next.regNo = regError
    if (Object.keys(next).length) return setErrors(next)

    setErrors({}); setBusy(true)
    const payload = {
      ...values,
      odometerKm: values.odometerKm ? Number(values.odometerKm) : null,
      insuranceDue: values.insuranceDue ? new Date(values.insuranceDue).getTime() : null,
      pucDue: values.pucDue ? new Date(values.pucDue).getTime() : null,
      serviceDue: values.serviceDue ? new Date(values.serviceDue).getTime() : null,
    }
    try {
      const { vehicle: saved } = vehicle
        ? await Api.updateVehicle(vehicle.id, payload)
        : await Api.addVehicle(payload)
      onSaved(saved)
      toast.success(vehicle ? 'Vehicle updated' : 'Vehicle added')
    } catch (e) {
      setErrors(e.errors || {})
      if (!e.errors) toast.error(e)
    } finally { setBusy(false) }
  }

  return (
    <div className="stack">
      <Field label="Nickname" htmlFor="v-nick" error={errors.nickname} required>
        <TextInput id="v-nick" placeholder="Classic 350" value={values.nickname}
                   error={errors.nickname} autoFocus onChange={set('nickname')} />
      </Field>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <Field label="Brand" htmlFor="v-brand"><TextInput id="v-brand" placeholder="Royal Enfield"
               value={values.brand} onChange={set('brand')} /></Field>
        <Field label="Model" htmlFor="v-model"><TextInput id="v-model" placeholder="Classic"
               value={values.model} onChange={set('model')} /></Field>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <Field label="Reg. no." htmlFor="v-reg" error={errors.regNo}>
          <TextInput id="v-reg" placeholder="KA01AB1234" value={values.regNo}
                     error={errors.regNo} onChange={set('regNo')} />
        </Field>
        <Field label="Odometer (km)" htmlFor="v-odo" error={errors.odometerKm}>
          <TextInput id="v-odo" inputMode="numeric" placeholder="12000" value={values.odometerKm}
                     error={errors.odometerKm} onChange={set('odometerKm')} />
        </Field>
      </div>
      <Field label="🛡️ Insurance expiry" htmlFor="v-ins">
        <input id="v-ins" className="input" type="date" value={values.insuranceDue} onChange={set('insuranceDue')} />
      </Field>
      <Field label="🌱 PUC expiry" htmlFor="v-puc">
        <input id="v-puc" className="input" type="date" value={values.pucDue} onChange={set('pucDue')} />
      </Field>
      <Field label="🔧 Service due" htmlFor="v-svc">
        <input id="v-svc" className="input" type="date" value={values.serviceDue} onChange={set('serviceDue')} />
      </Field>
      <div className="row" style={{ gap: 8, marginTop: 'var(--sp-2)' }}>
        <Button block onClick={onCancel}>Cancel</Button>
        <Button variant="primary" block loading={busy} onClick={submit}>Save</Button>
      </div>
    </div>
  )
}
