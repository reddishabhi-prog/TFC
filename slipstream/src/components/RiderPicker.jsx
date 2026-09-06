import { useEffect, useRef, useState } from 'react'
import { Api } from '../services/api'
import { Button, Field, Avatar } from './ui'
import { Icon } from '../components/Icon'
import { validatePhone, validateName, digitsOnly } from '../utils/validate'

/**
 * Finding riders to add, by search or by inviting a number that isn't on
 * Slipstream yet. This replaces typing bare names into a text box: every rider
 * added here is a real account that can sign in and settle up later.
 *
 * Selected riders render as removable chips rather than a plain list, so a
 * long group stays compact and each entry has its own remove target.
 */
// Contact Picker API: Android Chrome/Chromium only — no iOS Safari or desktop
// support at all. Feature-detected so the button simply doesn't render where
// it can't work; those riders still fall back to typing a number by hand.
const contactsSupported =
  typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window

function whatsappInviteUrl(name, phoneDigits) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const firstName = String(name ?? '').trim().split(/\s+/)[0] || 'there'
  const text = `Hey ${firstName}! I'm using Slipstream to plan our rides — join the group here: ${origin}`
  return `https://wa.me/91${phoneDigits}?text=${encodeURIComponent(text)}`
}

export function RiderPicker({ selected, onAdd, onRemove, leaderId, onMakeLeader, excludeIds = [] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [error, setError] = useState('')
  const [waInvite, setWaInvite] = useState(null)
  const debounce = useRef()
  const abort = useRef()

  const digits = digitsOnly(query)
  const looksLikePhone = digits.length === 10
  const alreadyHave = (id) => selected.some((s) => s.id === id) || excludeIds.includes(id)

  async function pickFromContacts() {
    setError(''); setWaInvite(null)
    try {
      const [contact] = await navigator.contacts.select(['name', 'tel'], { multiple: false })
      if (!contact) return
      const name = contact.name?.[0] ?? ''
      const phone = digitsOnly(contact.tel?.[0] ?? '', 12).slice(-10)
      setInviteName(name)
      setQuery(phone)
      setResults([])
    } catch (e) {
      if (e.name !== 'AbortError') setError('Could not read that contact')
    }
  }

  useEffect(() => {
    clearTimeout(debounce.current)
    if (query.trim().length < 3) { setResults([]); setSearching(false); return }

    setSearching(true)
    debounce.current = setTimeout(async () => {
      // Cancel the previous request so a slow early keystroke can't overwrite
      // results for what the user has since typed.
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      try {
        const { results } = await Api.searchUsers(query.trim(), { signal: controller.signal })
        setResults(results.filter((r) => !alreadyHave(r.id)))
      } catch (e) {
        if (e.name !== 'AbortError') setResults([])
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 280)

    return () => clearTimeout(debounce.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selected.length])

  function pick(rider) {
    onAdd({ id: rider.id, name: rider.name, avatarColor: rider.avatarColor })
    setQuery(''); setResults([]); setError('')
  }

  async function invite() {
    const nameError = validateName(inviteName, { field: 'Name' })
    if (nameError) return setError(nameError)
    const phoneError = validatePhone(digits)
    if (phoneError) return setError(phoneError)

    const name = inviteName.trim()
    setInviting(true); setError(''); setWaInvite(null)
    try {
      const { user } = await Api.inviteUser({ name, phone: digits })
      if (alreadyHave(user.id)) {
        setError('That rider is already in this group')
      } else {
        pick({ id: user.id, name: user.name, avatarColor: user.avatarColor })
        setWaInvite({ name, url: whatsappInviteUrl(name, digits) })
      }
      setInviteName('')
    } catch (e) {
      setError(e.message)
    } finally {
      setInviting(false)
    }
  }

  return (
    <div className="stack">
      {selected.length > 0 && (
        <div className="rider-chips">
          {selected.map((r) => {
            const isLeader = leaderId === r.id
            return (
              <span key={r.id} className={`rider-chip ${isLeader ? 'is-leader' : ''}`}>
                <Avatar name={r.name} color={r.avatarColor} size="xs" />
                <span className="rider-chip-name">{r.name}</span>
                {isLeader && <span className="pill pill-brand">Leader</span>}
                {onMakeLeader && !isLeader && (
                  <button className="rider-chip-x" title={`Make ${r.name} the leader`}
                          aria-label={`Make ${r.name} the leader`} onClick={() => onMakeLeader(r.id)}>
                    <Icon name="trophy" size={12} />
                  </button>
                )}
                {onRemove && (
                  <button className="rider-chip-x" aria-label={`Remove ${r.name}`} onClick={() => onRemove(r.id)}>
                    <Icon name="close" size={12} />
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}

      <Field label="Add riders" htmlFor="rider-search" error={error}
             hint="Search by name, or type a 10-digit number to invite someone new">
        <div className="search-wrap">
          <Icon name="search" size={17} className="search-icon" />
          <input
            id="rider-search" className="input" value={query} placeholder="Name or mobile number"
            onChange={(e) => { setQuery(e.target.value); setError(''); setWaInvite(null) }}
          />
          {searching && <span className="btn-spinner search-spin" aria-hidden="true" />}
        </div>
      </Field>

      {contactsSupported && (
        <button type="button" className="link-btn" onClick={pickFromContacts}>
          <Icon name="users" size={15} /> Add from contacts
        </button>
      )}

      {results.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {results.map((r) => (
            <button key={r.id} className="list-row" onClick={() => pick(r)}>
              <Avatar name={r.name} color={r.avatarColor} size="sm" />
              <span className="grow">
                <span className="list-row-title">{r.name}</span>
                {r.phoneHint && <span className="list-row-sub">{r.phoneHint}</span>}
              </span>
              <Icon name="plus" size={17} />
            </button>
          ))}
        </div>
      )}

      {looksLikePhone && results.length === 0 && !searching && (
        <div className="card invite-card">
          <div className="row" style={{ gap: 8 }}>
            <Icon name="link" size={16} />
            <span className="strong">Not on Slipstream yet</span>
          </div>
          <p className="caption" style={{ marginTop: 4 }}>
            Add them anyway — they can settle up when they join with {digits}.
          </p>
          <div className="row" style={{ marginTop: 'var(--sp-3)', gap: 8 }}>
            <input
              className="input grow" placeholder="Their name" value={inviteName}
              onChange={(e) => { setInviteName(e.target.value); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && invite()}
            />
            <Button variant="primary" onClick={invite} loading={inviting}>Invite</Button>
          </div>
        </div>
      )}

      {waInvite && (
        <div className="card invite-card">
          <div className="row" style={{ gap: 8 }}>
            <Icon name="check" size={16} />
            <span className="strong">{waInvite.name} added</span>
          </div>
          <p className="caption" style={{ marginTop: 4 }}>
            Send them the invite on WhatsApp so they know to join.
          </p>
          <a
            className="btn btn-primary" style={{ marginTop: 'var(--sp-3)' }}
            href={waInvite.url} target="_blank" rel="noopener noreferrer"
            onClick={() => setWaInvite(null)}
          >
            <Icon name="send" size={15} /> Message on WhatsApp
          </a>
        </div>
      )}
    </div>
  )
}
