/** Money is stored in paise everywhere; only the view layer sees rupees. */
export function rupees(paise, { sign = false } = {}) {
  const value = Math.abs(paise) / 100
  const text = value.toLocaleString('en-IN', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
  const prefix = sign && paise !== 0 ? (paise > 0 ? '+' : '−') : ''
  return `${prefix}₹${text}`
}

/** "gAURAV mehta" -> "Gaurav Mehta". Names arrive typed however people type them. */
export function titleCase(name) {
  return String(name ?? '')
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ')
}

export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function firstName(name) {
  return titleCase(String(name ?? '').trim().split(/\s+/)[0] || '')
}

const DAY = 86400000

export function relativeTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < DAY) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function clockTime(ts) {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

export function dayLabel(ts) {
  const d = new Date(ts)
  const today = new Date()
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const delta = Math.round((startOf(d) - startOf(today)) / DAY)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  if (delta === -1) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function dateTimeLabel(ts) {
  return `${dayLabel(ts)} · ${clockTime(ts)}`
}

/** Local-time value for <input type="datetime-local">, which has no timezone. */
export function toLocalInput(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fromLocalInput = (value) => new Date(value).getTime()

export function durationLabel(hours) {
  if (!hours) return ''
  if (hours < 24) return `${hours}h on the road`
  const days = Math.round(hours / 24)
  return `${days} day${days > 1 ? 's' : ''}`
}
