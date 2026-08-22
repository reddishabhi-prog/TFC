import { useState } from 'react'
import { Api, ApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContext'
import { Button, Field, TextInput, Segmented } from '../components/ui'
import { LogoMark, Icon } from '../components/Icon'
import { validatePhone, validateEmail, validateName, validatePassword, digitsOnly } from '../utils/validate'

/**
 * Sign-in sits between the splash and the app: nothing past this screen renders
 * until there is a real authenticated user, so the home screen can always
 * greet someone by name.
 *
 * Two routes in: phone + OTP (primary — matches how riders actually sign up)
 * and email + password (for anyone who wants a password).
 */
export function AuthScreen() {
  const { adopt } = useAuth()
  const toast = useToast()
  const [mode, setMode] = useState('phone')

  return (
    <div className="auth-screen">
      <div className="auth-hero">
        <LogoMark size={64} />
        <h1 className="auth-title">Welcome to Slipstream</h1>
        <p className="auth-tag">
          Live tracking, one-tap SOS, and expense splitting that actually adds up.
        </p>
      </div>

      <div className="auth-sheet">
        <Segmented
          label="Sign-in method"
          value={mode}
          onChange={setMode}
          options={[{ value: 'phone', label: 'Mobile' }, { value: 'email', label: 'Email' }]}
        />
        {mode === 'phone'
          ? <PhoneFlow onDone={adopt} toast={toast} />
          : <EmailFlow onDone={adopt} toast={toast} />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- phone + OTP */

function PhoneFlow({ onDone, toast }) {
  const [step, setStep] = useState('phone')   // phone -> code -> name
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(null)
  const [devCode, setDevCode] = useState('')

  async function sendCode() {
    const error = validatePhone(phone)
    if (error) return setErrors({ phone: error })
    setErrors({}); setBusy('send')
    try {
      const res = await Api.sendOtp(phone)
      setStep('code')
      // Without an SMS provider the server hands the code back in dev; showing
      // it beats pretending a message was sent.
      if (res.devCode) { setDevCode(res.devCode); toast.push(`Dev code: ${res.devCode}`) }
      else toast.success('Code sent')
    } catch (e) {
      setErrors(e.errors || {})
      if (!e.field) toast.error(e)
    } finally { setBusy(null) }
  }

  async function verify(withName) {
    if (code.length < 4) return setErrors({ code: 'Enter the code you received' })
    if (withName) {
      const error = validateName(name, { field: 'Name' })
      if (error) return setErrors({ name: error })
    }
    setErrors({}); setBusy('verify')
    try {
      const res = await Api.verifyOtp({ phone, code, name: withName ? name : undefined })
      onDone(res)
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && e.errors?.name) {
        // First time this number has been seen — collect a name, keep the code.
        setStep('name'); setErrors({})
      } else {
        setErrors(e.errors || {})
        if (!e.field) toast.error(e)
      }
    } finally { setBusy(null) }
  }

  if (step === 'phone') {
    return (
      <div className="stack">
        <Field label="Mobile number" htmlFor="phone" error={errors.phone} required
               hint="We'll text you a 6-digit code">
          <div className="input-group">
            <span className="input-prefix">+91</span>
            <input
              id="phone" className="input" type="tel" inputMode="numeric" autoComplete="tel"
              placeholder="10-digit number" value={phone}
              aria-invalid={!!errors.phone}
              onChange={(e) => setPhone(digitsOnly(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && sendCode()}
            />
          </div>
        </Field>
        <Button variant="primary" size="lg" block loading={busy === 'send'}
                disabled={phone.length !== 10} onClick={sendCode}>
          Send verification code
        </Button>
      </div>
    )
  }

  if (step === 'code') {
    return (
      <div className="stack">
        <Field label={`Enter the code sent to +91 ${phone}`} htmlFor="code" error={errors.code}
               hint={devCode ? `Development code: ${devCode}` : 'The code expires in 5 minutes'}>
          <input
            id="code" className="input otp-input" inputMode="numeric" autoComplete="one-time-code"
            placeholder="••••••" value={code} autoFocus maxLength={6}
            aria-invalid={!!errors.code}
            onChange={(e) => setCode(digitsOnly(e.target.value, 6))}
            onKeyDown={(e) => e.key === 'Enter' && verify(false)}
          />
        </Field>
        <Button variant="primary" size="lg" block loading={busy === 'verify'}
                disabled={code.length < 4} onClick={() => verify(false)}>
          Verify &amp; continue
        </Button>
        <Button variant="ghost" block onClick={() => { setStep('phone'); setCode(''); setErrors({}) }}>
          <Icon name="arrowLeft" size={16} /> Use a different number
        </Button>
      </div>
    )
  }

  return (
    <div className="stack">
      <Field label="What should we call you?" htmlFor="name" error={errors.name} required
             hint="Riders on your rides will see this name">
        <TextInput id="name" placeholder="Your name" value={name} autoFocus
                   error={errors.name}
                   onChange={(e) => setName(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && verify(true)} />
      </Field>
      <Button variant="primary" size="lg" block loading={busy === 'verify'}
              disabled={!name.trim()} onClick={() => verify(true)}>
        Create my account
      </Button>
    </div>
  )
}

/* --------------------------------------------------------- email + password */

function EmailFlow({ onDone, toast }) {
  const [isNew, setIsNew] = useState(false)
  const [values, setValues] = useState({ name: '', email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }))

  async function submit() {
    const next = {}
    if (isNew) {
      const nameError = validateName(values.name, { field: 'Name' })
      if (nameError) next.name = nameError
    }
    const emailError = validateEmail(values.email, { required: true })
    if (emailError) next.email = emailError
    if (isNew) {
      const pwError = validatePassword(values.password)
      if (pwError) next.password = pwError
    } else if (!values.password) {
      next.password = 'Password is required'
    }
    if (Object.keys(next).length) return setErrors(next)

    setErrors({}); setBusy(true)
    try {
      const res = isNew ? await Api.register(values) : await Api.login(values)
      onDone(res)
    } catch (e) {
      setErrors(e.errors || {})
      if (!e.field && !e.errors) toast.error(e)
    } finally { setBusy(false) }
  }

  return (
    <div className="stack">
      {isNew && (
        <Field label="Your name" htmlFor="rname" error={errors.name} required>
          <TextInput id="rname" placeholder="Arjun Rao" value={values.name}
                     error={errors.name} onChange={set('name')} autoComplete="name" />
        </Field>
      )}
      <Field label="Email" htmlFor="remail" error={errors.email} required>
        <TextInput id="remail" type="email" placeholder="you@example.com" value={values.email}
                   error={errors.email} onChange={set('email')} autoComplete="email" />
      </Field>
      <Field label="Password" htmlFor="rpw" error={errors.password} required
             hint={isNew ? 'At least 8 characters, mixing letters and numbers' : undefined}>
        <TextInput id="rpw" type="password" value={values.password}
                   error={errors.password} onChange={set('password')}
                   autoComplete={isNew ? 'new-password' : 'current-password'}
                   onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </Field>
      <Button variant="primary" size="lg" block loading={busy} onClick={submit}>
        {isNew ? 'Create account' : 'Sign in'}
      </Button>
      <Button variant="ghost" block onClick={() => { setIsNew((v) => !v); setErrors({}) }}>
        {isNew ? 'I already have an account' : 'New here? Create an account'}
      </Button>
    </div>
  )
}
