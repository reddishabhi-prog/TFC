import { useCallback, useEffect, useMemo, useState } from 'react'
import { Api } from '../services/api'
import { useAuth, useToast } from '../context/AppContext'
import {
  Button, Field, TextInput, EmptyState, SkeletonList, ConfirmDialog, Sheet, Avatar, Pill, ChipGroup,
} from '../components/ui'
import { RiderPicker } from '../components/RiderPicker'
import { Icon } from '../components/Icon'
import { rupees, dayLabel, toLocalInput, fromLocalInput } from '../utils/format'
import { parseAmount } from '../utils/validate'

const CATEGORIES = [
  { value: 'fuel',  label: 'Fuel',  icon: '⛽' },
  { value: 'food',  label: 'Food',  icon: '🍜' },
  { value: 'toll',  label: 'Toll',  icon: '🛣️' },
  { value: 'stay',  label: 'Stay',  icon: '🏨' },
  { value: 'other', label: 'Other', icon: '🧾' },
]
const categoryIcon = (v) => CATEGORIES.find((c) => c.value === v)?.icon ?? '🧾'

export function SplitScreen({ onNavigate }) {
  const { user } = useAuth()
  const toast = useToast()
  const [groups, setGroups] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [sheet, setSheet] = useState(null)          // 'expense' | 'group' | 'members'
  const [editing, setEditing] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (preferId) => {
    try {
      const { groups } = await Api.groups()
      setGroups(groups)
      setActiveId((current) => preferId ?? current ?? groups[0]?.id ?? null)
    } catch (e) {
      toast.error(e)
      setGroups([])
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const group = useMemo(
    () => groups?.find((g) => g.id === activeId) ?? null,
    [groups, activeId],
  )
  const myBalance = group?.balances.find((b) => b.id === user.id)?.net ?? 0

  /** Every mutation returns the whole group, so state stays in one place. */
  const applyGroup = (updated) => {
    setGroups((list) => list.map((g) => (g.id === updated.id ? updated : g)))
  }

  async function runSettlement({ from, to, amount }) {
    setBusy(true)
    try {
      const { group: updated } = await Api.settle(activeId, { from, to, amount: String(amount / 100) })
      applyGroup(updated)
      toast.success('Settlement recorded')
      setConfirm(null)
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  async function closeGroup() {
    setBusy(true)
    try {
      const { group: updated } = await Api.closeGroup(activeId)
      applyGroup(updated)
      toast.success('Group settled and closed 🎉')
      setConfirm(null)
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  async function deleteExpense(expense) {
    setBusy(true)
    try {
      const { group: updated } = await Api.deleteExpense(activeId, expense.id)
      applyGroup(updated)
      toast.success('Expense removed')
      setConfirm(null)
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  if (groups === null) {
    return (
      <div className="screen screen-enter">
        <header className="app-bar"><div className="app-bar-title"><div className="app-bar-title-1">Split</div></div></header>
        <div className="screen-scroll pad"><SkeletonList rows={3} /></div>
      </div>
    )
  }

  return (
    <div className="screen screen-enter">
      <header className="app-bar">
        <div className="app-bar-title">
          <div className="app-bar-title-1">Split</div>
          <div className="app-bar-title-2">Balances across your rides &amp; groups</div>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setSheet('group')}>Group</Button>
      </header>

      <div className="screen-scroll">
        {groups.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No groups yet"
            body="Create a group for a trip, a flat, or anything you split — no ride needed."
            action={<Button variant="primary" icon="plus" onClick={() => setSheet('group')}>New group</Button>}
          />
        ) : (
          <>
            <div className="pad">
              <Field label="Split with" htmlFor="group-select">
                <select id="group-select" className="input" value={activeId ?? ''}
                        onChange={(e) => setActiveId(e.target.value)}>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}{g.rideId ? ' · ride' : ''}{g.settledAt ? ' · settled' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {group && (
              <>
                <div className="pad" style={{ marginTop: 'var(--sp-4)' }}>
                  <div className="hero-card">
                    <div className="row-between">
                      <span className="hero-eyebrow">Your balance</span>
                      {group.settledAt && <Pill tone="success">Settled</Pill>}
                    </div>
                    <div className={`balance-figure ${myBalance > 0 ? 'positive' : myBalance < 0 ? 'negative' : ''}`}>
                      {myBalance === 0
                        ? 'All square'
                        : myBalance > 0
                          ? `You're owed ${rupees(myBalance)}`
                          : `You owe ${rupees(myBalance)}`}
                    </div>
                    <div className="hero-body">
                      {group.members.length} riders · {rupees(group.totalSpent)} spent total
                    </div>
                  </div>
                </div>

                <div className="section">
                  <div className="row-between" style={{ marginBottom: 'var(--sp-3)' }}>
                    <span className="section-title" style={{ margin: 0 }}>Who owes what</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSheet('members')}>
                      <Icon name="users" size={15} /> Members
                    </button>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    {group.balances.map((b) => (
                      <div className="list-row" key={b.id}>
                        <Avatar name={b.name} color={b.avatarColor} size="sm" />
                        <span className="grow">
                          <span className="list-row-title">{b.name}{b.id === user.id ? ' (you)' : ''}</span>
                          <span className="list-row-sub">
                            {b.net === 0 ? 'Settled up' : b.net > 0 ? 'is owed' : 'owes'}
                          </span>
                        </span>
                        <span className={`money ${b.net > 0 ? 'positive' : b.net < 0 ? 'negative' : 'muted'}`}>
                          {b.net === 0 ? '—' : rupees(b.net)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {group.suggested.length > 0 && (
                  <div className="section">
                    <div className="section-title">Settle up</div>
                    <div className="stack" style={{ gap: 6 }}>
                      {group.suggested.map((t, i) => (
                        <div className="list-row" key={i}>
                          <span className="list-row-icon"><Icon name="wallet" size={18} /></span>
                          <span className="grow">
                            <span className="list-row-title">
                              {t.from.id === user.id ? 'You' : t.from.name} → {t.to.id === user.id ? 'you' : t.to.name}
                            </span>
                            <span className="list-row-sub">{rupees(t.amount)}</span>
                          </span>
                          <Button
                            variant="secondary" size="sm"
                            onClick={() => setConfirm({
                              kind: 'settle',
                              payload: { from: t.from.id, to: t.to.id, amount: t.amount },
                              title: 'Record this settlement?',
                              body: `${t.from.id === user.id ? 'You' : t.from.name} paid ${
                                t.to.id === user.id ? 'you' : t.to.name} ${rupees(t.amount)}. This updates both balances and can't be undone.`,
                            })}
                          >
                            Mark paid
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="section">
                  <div className="row-between" style={{ marginBottom: 'var(--sp-3)' }}>
                    <span className="section-title" style={{ margin: 0 }}>Expenses</span>
                    {!group.settledAt && (
                      <Button variant="primary" size="sm" icon="plus"
                              onClick={() => { setEditing(null); setSheet('expense') }}>
                        Add
                      </Button>
                    )}
                  </div>

                  {group.expenses.length === 0 ? (
                    <EmptyState icon="🧾" title="No expenses yet"
                                body="Log the first fuel stop or chai break and we'll split it." />
                  ) : (
                    <div className="stack" style={{ gap: 6 }}>
                      {group.expenses.map((e) => {
                        const mine = e.createdBy === user.id
                        return (
                          <div className="list-row" key={e.id}>
                            <span className="expense-cat" aria-hidden="true">{categoryIcon(e.category)}</span>
                            <span className="grow">
                              <span className="list-row-title">{e.description}</span>
                              <span className="list-row-sub">
                                {e.paidBy === user.id ? 'You' : e.paidByName} paid · {dayLabel(e.spentAt)}
                                {e.updatedAt ? ' · edited' : ''}
                              </span>
                            </span>
                            <span className="money">{rupees(e.amount)}</span>
                            {mine && !group.settledAt && (
                              <>
                                <button className="icon-btn" aria-label={`Edit ${e.description}`}
                                        onClick={() => { setEditing(e); setSheet('expense') }}>
                                  <Icon name="edit" size={16} />
                                </button>
                                <button className="icon-btn" aria-label={`Delete ${e.description}`}
                                        onClick={() => setConfirm({
                                          kind: 'delete-expense', payload: e,
                                          title: 'Delete this expense?',
                                          body: `"${e.description}" (${rupees(e.amount)}) will be removed and everyone's balance recalculated.`,
                                          variant: 'danger', confirmLabel: 'Delete',
                                        })}>
                                  <Icon name="trash" size={16} />
                                </button>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Closing is only offered once every balance is zero — the
                    button explains itself rather than sitting dead. */}
                {!group.settledAt && group.expenses.length > 0 && (
                  <div className="section">
                    <Button
                      variant={group.isSettled ? 'primary' : 'secondary'}
                      block size="lg"
                      disabled={!group.canSettleGroup}
                      icon={group.isSettled ? 'check' : undefined}
                      onClick={() => setConfirm({
                        kind: 'close',
                        title: 'Close this group?',
                        body: `Everyone in ${group.name} is settled up. Closing locks the ledger — no new expenses can be added.`,
                        confirmLabel: 'Settle group',
                      })}
                    >
                      {group.isSettled ? 'Settle group' : 'Settle everyone up first'}
                    </Button>
                    {!group.isSettled && (
                      <p className="caption" style={{ textAlign: 'center', marginTop: 'var(--sp-2)' }}>
                        {group.balances.filter((b) => b.net !== 0).length} rider(s) still have an open balance.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <Sheet open={sheet === 'expense'} onClose={() => setSheet(null)}
             title={editing ? 'Edit expense' : 'Add an expense'}>
        <ExpenseForm
          group={group} expense={editing} me={user}
          onCancel={() => setSheet(null)}
          onSaved={(updated) => { applyGroup(updated); setSheet(null); setEditing(null) }}
        />
      </Sheet>

      <Sheet open={sheet === 'group'} onClose={() => setSheet(null)} title="New split group">
        <NewGroupForm
          onCancel={() => setSheet(null)}
          onCreated={(g) => { setGroups((list) => [g, ...(list ?? [])]); setActiveId(g.id); setSheet(null) }}
        />
      </Sheet>

      <Sheet open={sheet === 'members'} onClose={() => setSheet(null)} title={`${group?.name ?? ''} members`}>
        {group && (
          <MembersEditor group={group} me={user} onChanged={applyGroup} onClose={() => setSheet(null)} />
        )}
      </Sheet>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel={confirm?.confirmLabel ?? 'Confirm'}
        variant={confirm?.variant ?? 'primary'}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm.kind === 'settle') runSettlement(confirm.payload)
          else if (confirm.kind === 'close') closeGroup()
          else if (confirm.kind === 'delete-expense') deleteExpense(confirm.payload)
        }}
      />
    </div>
  )
}

/* ---------------------------------------------------------- expense form -- */

function ExpenseForm({ group, expense, me, onSaved, onCancel }) {
  const toast = useToast()
  const [values, setValues] = useState(() => ({
    description: expense?.description ?? '',
    amount: expense ? String(expense.amount / 100) : '',
    category: expense?.category ?? 'fuel',
    paidBy: expense?.paidBy ?? me.id,
    spentAt: toLocalInput(expense?.spentAt ?? Date.now()),
    participants: expense
      ? expense.shares.map((s) => s.userId)
      : group.members.map((m) => m.id),
  }))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }))
  const toggleParticipant = (id) => setValues((v) => ({
    ...v,
    participants: v.participants.includes(id)
      ? v.participants.filter((p) => p !== id)
      : [...v.participants, id],
  }))

  const { paise } = parseAmount(values.amount)
  const perHead = paise && values.participants.length
    ? Math.floor(paise / values.participants.length)
    : 0

  async function submit() {
    const next = {}
    if (!values.description.trim()) next.description = 'What was it for?'
    const { paise, error } = parseAmount(values.amount)
    if (error) next.amount = error
    if (!values.participants.length) next.participants = 'Pick at least one rider'
    if (Object.keys(next).length) return setErrors(next)

    setErrors({}); setBusy(true)
    const payload = {
      description: values.description.trim(),
      amount: String(paise / 100),
      category: values.category,
      paidBy: values.paidBy,
      spentAt: fromLocalInput(values.spentAt),
      participants: values.participants,
    }
    try {
      const { group: updated } = expense
        ? await Api.updateExpense(group.id, expense.id, payload)
        : await Api.addExpense(group.id, payload)
      onSaved(updated)
      toast.success(expense ? 'Expense updated' : 'Expense added')
    } catch (e) {
      setErrors(e.errors || {})
      if (!e.field && !e.errors) toast.error(e)
    } finally { setBusy(false) }
  }

  return (
    <div className="stack">
      <Field label="What was it for?" htmlFor="exp-desc" error={errors.description} required>
        <TextInput id="exp-desc" placeholder="Petrol at Hassan" value={values.description}
                   error={errors.description} autoFocus
                   onChange={(e) => set('description', e.target.value)} />
      </Field>

      <Field label="Amount" htmlFor="exp-amt" error={errors.amount} required>
        <div className="input-group">
          <span className="input-prefix">₹</span>
          <input id="exp-amt" className="input" inputMode="decimal" placeholder="1200"
                 value={values.amount} aria-invalid={!!errors.amount}
                 onChange={(e) => set('amount', e.target.value)} />
        </div>
      </Field>

      <Field label="Category" htmlFor="exp-cat">
        <ChipGroup label="Category" options={CATEGORIES} value={values.category}
                   onChange={(v) => set('category', v)} />
      </Field>

      <Field label="Paid by" htmlFor="exp-paid">
        <select id="exp-paid" className="input" value={values.paidBy}
                onChange={(e) => set('paidBy', e.target.value)}>
          {group.members.map((m) => (
            <option key={m.id} value={m.id}>{m.id === me.id ? 'You' : m.name}</option>
          ))}
        </select>
      </Field>

      <Field label="When" htmlFor="exp-when">
        <input id="exp-when" className="input" type="datetime-local" value={values.spentAt}
               onChange={(e) => set('spentAt', e.target.value)} />
      </Field>

      <Field label="Split between" htmlFor="exp-split" error={errors.participants}
             hint={perHead ? `${rupees(perHead)} each` : undefined}>
        <div className="stack" style={{ gap: 6 }}>
          {group.members.map((m) => {
            const on = values.participants.includes(m.id)
            return (
              <button key={m.id} type="button" className={`split-row ${on ? 'on' : ''}`}
                      role="checkbox" aria-checked={on}
                      onClick={() => toggleParticipant(m.id)}>
                <Avatar name={m.name} color={m.avatarColor} size="sm" />
                <span className="grow list-row-title">{m.id === me.id ? 'You' : m.name}</span>
                <span className={`split-check ${on ? 'on' : ''}`}>
                  {on && <Icon name="check" size={13} />}
                </span>
              </button>
            )
          })}
        </div>
      </Field>

      <div className="row" style={{ gap: 8, marginTop: 'var(--sp-2)' }}>
        <Button block onClick={onCancel}>Cancel</Button>
        <Button variant="primary" block loading={busy} onClick={submit}>
          {expense ? 'Save changes' : 'Add expense'}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ new group --- */

function NewGroupForm({ onCreated, onCancel }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [members, setMembers] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) return setError('Give the group a name')
    setBusy(true); setError('')
    try {
      const { group } = await Api.createGroup({ name: name.trim(), memberIds: members.map((m) => m.id) })
      onCreated(group)
      toast.success('Group created')
    } catch (e) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="stack">
      <Field label="Group name" htmlFor="grp-name" error={error} required
             hint="Goa Trip, Flatmates, Sunday Breakfast Club…">
        <TextInput id="grp-name" placeholder="Goa Trip" value={name} autoFocus
                   error={error} onChange={(e) => { setName(e.target.value); setError('') }} />
      </Field>

      <RiderPicker
        selected={members}
        onAdd={(r) => setMembers((m) => [...m, r])}
        onRemove={(id) => setMembers((m) => m.filter((x) => x.id !== id))}
      />

      <div className="row" style={{ gap: 8, marginTop: 'var(--sp-2)' }}>
        <Button block onClick={onCancel}>Cancel</Button>
        <Button variant="primary" block loading={busy} disabled={!name.trim()} onClick={submit}>
          Create group
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------- members editor -- */

function MembersEditor({ group, me, onChanged, onClose }) {
  const toast = useToast()
  const selected = group.members.map((m) => ({ id: m.id, name: m.name, avatarColor: m.avatarColor }))

  async function add(rider) {
    try {
      const { group: updated } = await Api.addGroupMember(group.id, rider.id)
      onChanged(updated)
      toast.success(`${rider.name} added`)
    } catch (e) { toast.error(e) }
  }

  async function remove(id) {
    if (id === me.id) return toast.error("You can't remove yourself")
    try {
      const { group: updated } = await Api.removeGroupMember(group.id, id)
      onChanged(updated)
      toast.success('Rider removed')
    } catch (e) { toast.error(e) }
  }

  return (
    <div className="stack">
      <RiderPicker selected={selected} onAdd={add} onRemove={group.settledAt ? undefined : remove} />
      <Button block onClick={onClose}>Done</Button>
    </div>
  )
}
