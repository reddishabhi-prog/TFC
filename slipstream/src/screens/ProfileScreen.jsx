import { useRef, useState } from 'react'
import { Api, getToken } from '../services/api'
import { useAuth, useTheme, useToast } from '../context/AppContext'
import { Button, Field, TextInput, Segmented, ConfirmDialog, Avatar } from '../components/ui'
import { Icon } from '../components/Icon'
import { RiderBadges } from '../components/RiderBadges'
import { validateName, validateEmail, validatePhone, digitsOnly } from '../utils/validate'
import { cropToSquare } from '../utils/cropImage'

const BLOOD_GROUPS = ['', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']

export function ProfileScreen({ onNavigate }) {
  const { user, setUser, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const toast = useToast()
  const photoRef = useRef(null)

  const [values, setValues] = useState({
    name: user.name ?? '',
    email: user.email ?? '',
    bloodGroup: user.bloodGroup ?? '',
    medicalNotes: user.medicalNotes ?? '',
    emergencyName: user.emergencyContact?.name ?? '',
    emergencyPhone: user.emergencyContact?.phone ?? '',
  })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)

  /** Crops to a square client-side, then uploads that square — no manual
   *  crop step for a rider to fumble through on a bike glove. */
  async function changePhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    try {
      const square = await cropToSquare(file)
      // Loaded on demand, same reasoning as the ride-memories upload: this
      // SDK's dependency chain has no business loading for anyone who never
      // touches their profile photo.
      const { upload } = await import('@vercel/blob/client')
      const blob = await upload(`avatars/${user.id}-${Date.now()}.jpg`, square, {
        access: 'public',
        handleUploadUrl: Api.avatarUploadUrl(),
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      const { user: saved } = await Api.updateMe({ avatarUrl: blob.url })
      setUser(saved)
      toast.success('Profile photo updated')
    } catch (err) {
      const raw = err?.message || ''
      toast.error(/retrieve the client token/i.test(raw)
        ? "Couldn't upload that photo — photo storage may not be set up yet."
        : raw || 'Could not update your photo — try again')
    } finally {
      setPhotoBusy(false)
    }
  }

  const set = (key, value) => { setValues((v) => ({ ...v, [key]: value })); setErrors((e) => ({ ...e, [key]: undefined })) }

  /** Client-side gate first for instant feedback; the server re-checks anyway. */
  async function save() {
    const next = {}
    const nameError = validateName(values.name, { field: 'Name' })
    if (nameError) next.name = nameError
    const emailError = validateEmail(values.email)
    if (emailError) next.email = emailError
    if (values.emergencyPhone) {
      const phoneError = validatePhone(values.emergencyPhone)
      if (phoneError) next.emergencyPhone = phoneError
    }
    if (values.emergencyPhone && !values.emergencyName.trim()) {
      next.emergencyName = 'Add a name for this contact'
    }
    if (Object.keys(next).length) {
      setErrors(next)
      return toast.error('Fix the highlighted fields')
    }

    setBusy(true)
    try {
      const { user: saved } = await Api.updateMe(values)
      setUser(saved)
      toast.success('Profile saved')
    } catch (e) {
      setErrors(e.errors || {})
      if (!e.errors) toast.error(e)
    } finally { setBusy(false) }
  }

  return (
    <div className="screen screen-enter">
      <header className="app-bar">
        <div className="app-bar-title">
          <div className="app-bar-title-1">Me</div>
          <div className="app-bar-title-2">Profile &amp; settings</div>
        </div>
      </header>

      <div className="screen-scroll">
        <div className="pad">
          <div className="profile-hero">
            <div className="profile-photo">
              <Avatar name={user.name} color={user.avatarColor} avatarUrl={user.avatarUrl} size="lg" />
              <button className="profile-photo-edit" onClick={() => photoRef.current?.click()}
                      disabled={photoBusy} aria-label="Change profile photo">
                <Icon name={photoBusy ? 'clock' : 'camera'} size={14} />
              </button>
              <input ref={photoRef} className="profile-photo-input" type="file" accept="image/*" hidden onChange={changePhoto} />
            </div>
            <div className="profile-name">{user.name}</div>
            <div className="caption">{user.phone ? `+91 ${user.phone}` : user.email}</div>
          </div>
        </div>

        <RiderBadges />

        <div className="section">
          <div className="section-title">Your details</div>
          <div className="card stack">
            <Field label="Name" htmlFor="p-name" error={errors.name} required>
              <TextInput id="p-name" value={values.name} error={errors.name}
                         autoComplete="name" onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="p-email" error={errors.email}
                   hint="Used for ride summaries and receipts">
              <TextInput id="p-email" type="email" placeholder="you@example.com" value={values.email}
                         error={errors.email} autoComplete="email"
                         onChange={(e) => set('email', e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Emergency contact</div>
          <div className="card stack">
            <Field label="Contact name" htmlFor="p-ename" error={errors.emergencyName}>
              <TextInput id="p-ename" placeholder="Dad, Priya…" value={values.emergencyName}
                         error={errors.emergencyName}
                         onChange={(e) => set('emergencyName', e.target.value)} />
            </Field>
            <Field label="Contact number" htmlFor="p-ephone" error={errors.emergencyPhone}>
              <div className="input-group">
                <span className="input-prefix">+91</span>
                <input id="p-ephone" className="input" type="tel" inputMode="numeric"
                       placeholder="10-digit number" value={values.emergencyPhone}
                       aria-invalid={!!errors.emergencyPhone}
                       onChange={(e) => set('emergencyPhone', digitsOnly(e.target.value))} />
              </div>
            </Field>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <Field label="Blood group" htmlFor="p-blood">
                <select id="p-blood" className="input" value={values.bloodGroup}
                        onChange={(e) => set('bloodGroup', e.target.value)}>
                  {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g || '—'}</option>)}
                </select>
              </Field>
              <Field label="Medical notes" htmlFor="p-med">
                <TextInput id="p-med" placeholder="Allergies, conditions" value={values.medicalNotes}
                           onChange={(e) => set('medicalNotes', e.target.value)} />
              </Field>
            </div>
            <p className="caption">Shared with your contact and group when you send an SOS.</p>
          </div>
        </div>

        <div className="section">
          <Button variant="primary" block size="lg" loading={busy} onClick={save}>Save changes</Button>
        </div>

        <div className="section">
          <div className="section-title">Appearance</div>
          <div className="card">
            <Segmented
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'light', label: '☀️ Light' },
                { value: 'dark', label: '🌙 Dark' },
              ]}
            />
          </div>
        </div>

        <div className="section">
          <div className="section-title">More</div>
          <div className="stack" style={{ gap: 6 }}>
            <button className="list-row" onClick={() => onNavigate('garage')}>
              <span className="list-row-icon"><Icon name="bike" size={18} /></span>
              <span className="grow"><span className="list-row-title">Bike garage</span>
                <span className="list-row-sub">Documents & service reminders</span></span>
              <Icon name="chevronRight" size={17} />
            </button>
            <button className="list-row" onClick={() => onNavigate('help')}>
              <span className="list-row-icon"><Icon name="help" size={18} /></span>
              <span className="grow"><span className="list-row-title">Help &amp; support</span>
                <span className="list-row-sub">FAQs and contact</span></span>
              <Icon name="chevronRight" size={17} />
            </button>
          </div>
        </div>

        <div className="section" style={{ paddingBottom: 'var(--sp-7)' }}>
          <Button variant="ghost" block icon="logout" onClick={() => setConfirmOut(true)}>Sign out</Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOut}
        title="Sign out?"
        body="You'll need your number and a fresh code to sign back in."
        confirmLabel="Sign out"
        variant="danger"
        onCancel={() => setConfirmOut(false)}
        onConfirm={logout}
      />
    </div>
  )
}
