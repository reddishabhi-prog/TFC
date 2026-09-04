import { useEffect, useState } from 'react'
import { Api } from '../services/api'
import { useAuth, useToast } from '../context/AppContext'
import { Button, TextInput, Avatar, Pill, EmptyState, SkeletonList } from './ui'
import { Icon } from './Icon'

/** The leader's pre-ride checklist. One shared list of items; each rider ticks
 *  their own copy, and everyone can see how ready everyone else is. */
export function RideChecklist({ ride }) {
  const { user } = useAuth()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)

  function load() {
    return Api.checklist(ride.id).then(setData).catch((e) => toast.error(e))
  }

  useEffect(() => { load() }, [ride.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addItem() {
    const text = label.trim()
    if (!text || adding) return
    setAdding(true)
    try {
      const { item } = await Api.addChecklistItem(ride.id, { label: text })
      setData((d) => ({ ...d, items: [...d.items, item] }))
      setLabel('')
    } catch (e) { toast.error(e) } finally { setAdding(false) }
  }

  async function removeItem(itemId) {
    const previous = data
    setData((d) => ({
      ...d,
      items: d.items.filter((i) => i.id !== itemId),
      myChecks: d.myChecks.filter((id) => id !== itemId),
    }))
    try {
      await Api.deleteChecklistItem(ride.id, itemId)
      load() // other riders' counts change too when an item disappears
    } catch (e) { toast.error(e); setData(previous) }
  }

  async function toggle(itemId) {
    const checked = data.myChecks.includes(itemId)
    setData((d) => ({
      ...d,
      myChecks: checked ? d.myChecks.filter((id) => id !== itemId) : [...d.myChecks, itemId],
      readiness: d.readiness.map((r) => (r.userId === user.id
        ? { ...r, checkedCount: r.checkedCount + (checked ? -1 : 1) }
        : r)),
    }))
    try {
      await Api.toggleChecklistItem(ride.id, itemId)
    } catch (e) { toast.error(e); load() }
  }

  if (!data) return <div className="screen-scroll pad"><SkeletonList rows={3} /></div>

  const total = data.items.length

  return (
    <div className="screen-scroll">
      {ride.isLeader && (
        <div className="section pad">
          <div className="section-title">Add an item</div>
          <div className="row" style={{ gap: 8 }}>
            <TextInput
              placeholder="Helmet, full tank, rain gear…"
              value={label}
              maxLength={80}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
            />
            <Button variant="primary" icon="plus" aria-label="Add item"
                    loading={adding} disabled={!label.trim()} onClick={addItem} />
          </div>
        </div>
      )}

      {total === 0 ? (
        <div className="pad">
          <EmptyState
            icon="✅"
            title="No checklist yet"
            body={ride.isLeader
              ? 'Add the things every rider should check off before you roll out.'
              : "The ride leader hasn't set a checklist for this ride."}
          />
        </div>
      ) : (
        <>
          <div className="section pad">
            <div className="section-title">
              Your checklist · {data.myChecks.length}/{total}
            </div>
            <div className="stack" style={{ gap: 6 }}>
              {data.items.map((item) => {
                const checked = data.myChecks.includes(item.id)
                return (
                  <div className={`checklist-row ${checked ? 'checked' : ''}`} key={item.id}>
                    <button className="checklist-tick" onClick={() => toggle(item.id)}
                            aria-pressed={checked} aria-label={`${checked ? 'Uncheck' : 'Check'} ${item.label}`}>
                      <span className="checklist-box" aria-hidden="true">
                        {checked && <Icon name="check" size={13} />}
                      </span>
                      <span className="checklist-label">{item.label}</span>
                    </button>
                    {ride.isLeader && (
                      <button className="checklist-remove" onClick={() => removeItem(item.id)}
                              aria-label={`Remove ${item.label}`}>
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="section pad">
            <div className="section-title">Who's ready</div>
            <div className="stack" style={{ gap: 6 }}>
              {data.readiness.map((r) => {
                const done = r.checkedCount >= total
                return (
                  <div className="list-row" key={r.userId}>
                    <Avatar name={r.name} color={r.avatarColor} size="sm" />
                    <span className="grow">
                      <span className="list-row-title">
                        {r.name}{r.userId === user.id ? ' (you)' : ''}
                      </span>
                      <span className="readiness-track" aria-hidden="true">
                        <span className={`readiness-fill ${done ? 'done' : ''}`}
                              style={{ width: `${total ? (r.checkedCount / total) * 100 : 0}%` }} />
                      </span>
                    </span>
                    <Pill tone={done ? 'success' : 'muted'}>
                      {done ? 'Ready' : `${r.checkedCount}/${total}`}
                    </Pill>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
