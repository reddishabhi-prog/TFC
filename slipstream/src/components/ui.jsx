import { useEffect, useRef } from 'react'
import { Icon } from './Icon'

/* ------------------------------------------------------------------ Button */

export function Button({
  variant = 'secondary', size, block, loading, disabled, icon, children, ...rest
}) {
  const cls = [
    'btn', `btn-${variant}`,
    size ? `btn-${size}` : '',
    block ? 'btn-block' : '',
  ].filter(Boolean).join(' ')
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={17} /> : null}
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------- Field */

/**
 * One labelled control with its helper text and error slot. Passing `error`
 * flips the visual state and wires aria-invalid/aria-describedby, so error
 * messaging is announced rather than only coloured red.
 */
export function Field({ label, htmlFor, error, hint, required, children }) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined
  return (
    <div className={`field ${error ? 'invalid' : ''}`}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}{required && <span className="req" aria-hidden="true">*</span>}
        </label>
      )}
      {typeof children === 'function'
        ? children({ id: htmlFor, 'aria-invalid': !!error, 'aria-describedby': describedBy })
        : children}
      {error
        ? <span className="field-error" id={`${htmlFor}-error`} role="alert">
            <Icon name="alert" size={13} /> {error}
          </span>
        : hint
          ? <span className="field-hint" id={`${htmlFor}-hint`}>{hint}</span>
          : null}
    </div>
  )
}

export function TextInput({ error, ...rest }) {
  return <input className="input" aria-invalid={!!error} {...rest} />
}

/* --------------------------------------------------------------- Segmented */

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ChipGroup({ options, value, onChange, label, multiple = false }) {
  const isOn = (v) => (multiple ? value?.includes(v) : value === v)
  return (
    <div className="chip-row" role={multiple ? 'group' : 'radiogroup'} aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role={multiple ? 'checkbox' : 'radio'}
          aria-checked={isOn(o.value)}
          className={`chip ${isOn(o.value) ? 'on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <span aria-hidden="true">{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------------- Avatars */

export function Avatar({ name, color, avatarUrl, size = 'sm' }) {
  const letters = String(name ?? '?').trim().split(/\s+/).filter(Boolean)
  const text = letters.length > 1
    ? (letters[0][0] + letters[letters.length - 1][0]).toUpperCase()
    : (letters[0] || '?').slice(0, 2).toUpperCase()
  return (
    <span className={`avatar avatar-${size}`} style={!avatarUrl && color ? { background: color } : undefined} aria-hidden="true">
      {avatarUrl
        ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : text}
    </span>
  )
}

export function AvatarStack({ people = [], max = 4 }) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  return (
    <span className="avatar-stack">
      {shown.map((p) => <Avatar key={p.id} name={p.name} color={p.avatarColor} size="xs" />)}
      {rest > 0 && <span className="avatar avatar-xs" style={{ background: 'var(--ink-400)' }}>+{rest}</span>}
    </span>
  )
}

/* ------------------------------------------------------------------ States */

export function EmptyState({ icon = '🏍️', title, body, action }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <div className="empty-title">{title}</div>
      {body && <p className="empty-body">{body}</p>}
      {action}
    </div>
  )
}

export function SkeletonList({ rows = 3 }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 10 }} />
          <div className="grow stack" style={{ gap: 8 }}>
            <div className="skeleton" style={{ height: 11, width: '60%' }} />
            <div className="skeleton" style={{ height: 9, width: '35%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ Dialog */

/**
 * Confirmation dialog. Focus moves to the panel on open and Escape cancels, so
 * destructive actions can never be confirmed by a stray click alone.
 */
export function ConfirmDialog({
  open, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  variant = 'primary', busy, onConfirm, onCancel,
}) {
  const panel = useRef(null)
  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null
  return (
    <div className="overlay" onClick={() => !busy && onCancel?.()}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title" id="confirm-title">{title}</div>
        {body && <div className="dialog-body">{body}</div>}
        <div className="dialog-actions">
          <Button onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant={variant} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- Sheet */

export function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <>
      <div className="overlay" style={{ alignItems: 'flex-end', padding: 0 }} onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" />
        {title && <div className="h3" style={{ marginBottom: 'var(--sp-4)' }}>{title}</div>}
        {children}
      </div>
    </>
  )
}

export function Pill({ tone = 'muted', children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}
