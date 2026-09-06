// Validation rules shared by the React forms and the Express routes, so the
// client-side hints and the server-side guarantees can never drift apart.

export const PHONE_RE = /^[6-9]\d{9}$/
// Deliberately pragmatic rather than RFC-complete: one @, a dotted domain, no
// spaces. Catches real typos without rejecting addresses people actually use.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i
export const REG_NO_RE = /^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{1,4}$/i

export function digitsOnly(value, max = 10) {
  return String(value ?? '').replace(/\D/g, '').slice(0, max)
}

/** Indian mobile: exactly 10 digits, starting 6-9. */
export function validatePhone(value) {
  const v = String(value ?? '').trim()
  if (!v) return 'Mobile number is required'
  if (!/^\d+$/.test(v)) return 'Use digits only'
  if (v.length !== 10) return 'Enter all 10 digits'
  if (!PHONE_RE.test(v)) return 'Indian numbers start with 6, 7, 8 or 9'
  return null
}

export function validateEmail(value, { required = false } = {}) {
  const v = String(value ?? '').trim()
  if (!v) return required ? 'Email is required' : null
  if (!EMAIL_RE.test(v)) return 'Enter a valid email like name@example.com'
  return null
}

export function validateName(value, { field = 'Name', min = 2, max = 40 } = {}) {
  const v = String(value ?? '').trim()
  if (!v) return `${field} is required`
  if (v.length < min) return `${field} must be at least ${min} characters`
  if (v.length > max) return `${field} must be under ${max} characters`
  return null
}

export function validatePassword(value) {
  const v = String(value ?? '')
  if (!v) return 'Password is required'
  if (v.length < 8) return 'Use at least 8 characters'
  if (!/[a-z]/i.test(v) || !/\d/.test(v)) return 'Mix letters and numbers'
  return null
}

/** Rupee amount typed by a human -> paise. Returns {error} or {paise}. */
export function parseAmount(value) {
  const v = String(value ?? '').trim().replace(/[₹,\s]/g, '')
  if (!v) return { error: 'Amount is required' }
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return { error: 'Enter an amount like 1250 or 1250.50' }
  const paise = Math.round(Number(v) * 100)
  if (paise <= 0) return { error: 'Amount must be more than ₹0' }
  if (paise > 10_000_000_00) return { error: 'That looks too large — check the amount' }
  return { paise }
}

export function validateOdometer(value) {
  const v = String(value ?? '').trim()
  if (!v) return null
  if (!/^\d{1,7}$/.test(v)) return 'Odometer must be a whole number of km'
  return null
}

export function validateRegNo(value) {
  const v = String(value ?? '').trim()
  if (!v) return null
  if (!REG_NO_RE.test(v)) return 'Use a format like KA01AB1234'
  return null
}

/** Runs a {field: validatorFn} map over values; returns {} when all pass. */
export function collectErrors(values, rules) {
  const errors = {}
  for (const [field, rule] of Object.entries(rules)) {
    const message = rule(values[field], values)
    if (message) errors[field] = message
  }
  return errors
}

export const isClean = (errors) => Object.keys(errors).length === 0
