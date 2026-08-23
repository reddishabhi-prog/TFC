import { Router } from 'express'
import { db, uid, now } from '../lib/db.js'
import { requireAuth } from '../lib/auth.js'
import { computeBalances, suggestSettlements, isGroupSettled, splitEvenly } from '../lib/balances.js'
import { validateName, parseAmount } from '../../src/utils/validate.js'

export const groupRoutes = Router()
groupRoutes.use(requireAuth)

const CATEGORIES = ['fuel', 'food', 'toll', 'stay', 'other']

async function memberIds(groupId) {
  const rows = await db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId)
  return rows.map((r) => r.user_id)
}

/** Every group route is membership-gated; non-members get a 404, not a 403. */
async function loadGroup(req, res, next) {
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id)
  if (!group) return res.status(404).json({ error: 'Group not found' })
  const ids = await memberIds(group.id)
  if (!ids.includes(req.user.id)) return res.status(404).json({ error: 'Group not found' })
  req.group = group
  next()
}

async function serializeGroup(group) {
  const balances = await computeBalances(group.id)
  const expenseRows = await db
    .prepare(
      `SELECT e.*, u.name AS "paidByName"
         FROM expenses e JOIN users u ON u.id = e.paid_by
        WHERE e.group_id = ? ORDER BY e.spent_at DESC, e.created_at DESC`,
    )
    .all(group.id)

  const expenses = await Promise.all(expenseRows.map(async (e) => ({
    id: e.id,
    description: e.description,
    category: e.category,
    amount: e.amount,
    paidBy: e.paid_by,
    paidByName: e.paidByName,
    createdBy: e.created_by,
    spentAt: Number(e.spent_at),
    updatedAt: e.updated_at ? Number(e.updated_at) : null,
    shares: await db.prepare('SELECT user_id AS "userId", share FROM expense_shares WHERE expense_id = ?').all(e.id),
  })))

  const settlements = await db.prepare('SELECT * FROM settlements WHERE group_id = ? ORDER BY created_at DESC').all(group.id)

  return {
    id: group.id,
    name: group.name,
    rideId: group.ride_id,
    createdBy: group.created_by,
    settledAt: group.settled_at ? Number(group.settled_at) : null,
    createdAt: Number(group.created_at),
    members: balances,
    balances,
    expenses,
    totalSpent: expenses.reduce((sum, e) => sum + e.amount, 0),
    settlements,
    suggested: suggestSettlements(balances),
    canSettleGroup: expenses.length > 0 && isGroupSettled(balances) && !group.settled_at,
    isSettled: isGroupSettled(balances),
  }
}

groupRoutes.get('/', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT g.* FROM groups g JOIN group_members gm ON gm.group_id = g.id
        WHERE gm.user_id = ? ORDER BY g.created_at DESC`,
    )
    .all(req.user.id)
  res.json({ groups: await Promise.all(rows.map(serializeGroup)) })
})

groupRoutes.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const error = validateName(name, { field: 'Group name', max: 60 })
  if (error) return res.status(400).json({ error, field: 'name' })

  const requested = Array.isArray(req.body?.memberIds) ? req.body.memberIds : []
  const ids = [...new Set([req.user.id, ...requested])]
  const placeholders = ids.map(() => '?').join(',')
  const known = (await db.prepare(`SELECT id FROM users WHERE id IN (${placeholders})`).all(...ids)).map((r) => r.id)

  const group = {
    id: uid('grp'),
    name,
    ride_id: req.body?.rideId ?? null,
    created_by: req.user.id,
    created_at: now(),
  }
  await db.transaction(async (tx) => {
    await tx.prepare(
      `INSERT INTO groups (id, name, ride_id, created_by, created_at) VALUES (?,?,?,?,?)`,
    ).run(group.id, group.name, group.ride_id, group.created_by, group.created_at)
    for (const id of known) {
      await tx.prepare('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
        .run(group.id, id, now())
    }
  })()

  const saved = await db.prepare('SELECT * FROM groups WHERE id = ?').get(group.id)
  res.status(201).json({ group: await serializeGroup(saved) })
})

groupRoutes.get('/:id', loadGroup, async (req, res) => res.json({ group: await serializeGroup(req.group) }))

groupRoutes.post('/:id/members', loadGroup, async (req, res) => {
  const userId = String(req.body?.userId ?? '')
  if (!(await db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId))) {
    return res.status(404).json({ error: 'That rider does not exist' })
  }
  await db.prepare('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(req.group.id, userId, now())
  res.json({ group: await serializeGroup(req.group) })
})

groupRoutes.delete('/:id/members/:userId', loadGroup, async (req, res) => {
  const { userId } = req.params
  // Removing someone mid-ledger would silently rewrite everyone else's share.
  const involved = (await db
    .prepare(
      `SELECT COUNT(*) AS n FROM expense_shares es
         JOIN expenses e ON e.id = es.expense_id
        WHERE e.group_id = ? AND es.user_id = ?`,
    )
    .get(req.group.id, userId)).n
  const paid = (await db.prepare('SELECT COUNT(*) AS n FROM expenses WHERE group_id = ? AND paid_by = ?')
    .get(req.group.id, userId)).n
  if (Number(involved) > 0 || Number(paid) > 0) {
    return res.status(409).json({ error: 'That rider is part of existing expenses — settle up first' })
  }
  await db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(req.group.id, userId)
  res.json({ group: await serializeGroup(req.group) })
})

async function readExpenseInput(req, group) {
  const description = String(req.body?.description ?? '').trim()
  if (!description) return { error: { error: 'What was it for?', field: 'description' } }

  const { paise, error: amountError } = parseAmount(req.body?.amount)
  if (amountError) return { error: { error: amountError, field: 'amount' } }

  const category = CATEGORIES.includes(req.body?.category) ? req.body.category : 'other'
  const paidBy = String(req.body?.paidBy ?? req.user.id)
  const members = await memberIds(group.id)
  if (!members.includes(paidBy)) return { error: { error: 'Payer must be in the group', field: 'paidBy' } }

  // Custom shares must name group members and add up to the total exactly.
  let shares
  if (Array.isArray(req.body?.shares) && req.body.shares.length) {
    shares = req.body.shares.map((s) => ({ userId: String(s.userId), share: Number(s.share) }))
    if (shares.some((s) => !members.includes(s.userId))) {
      return { error: { error: 'Split includes someone outside the group', field: 'shares' } }
    }
    if (shares.some((s) => !Number.isInteger(s.share) || s.share < 0)) {
      return { error: { error: 'Every share must be a whole number of paise', field: 'shares' } }
    }
    const sum = shares.reduce((a, s) => a + s.share, 0)
    if (sum !== paise) {
      return { error: { error: `Shares add up to ₹${(sum / 100).toFixed(2)} but the total is ₹${(paise / 100).toFixed(2)}`, field: 'shares' } }
    }
  } else {
    const participants = Array.isArray(req.body?.participants) && req.body.participants.length
      ? req.body.participants.filter((id) => members.includes(id))
      : members
    if (!participants.length) return { error: { error: 'Pick at least one rider to split with', field: 'participants' } }
    shares = splitEvenly(paise, participants)
  }

  const spentAt = Number(req.body?.spentAt) || now()
  return { value: { description, category, amount: paise, paidBy, shares, spentAt } }
}

groupRoutes.post('/:id/expenses', loadGroup, async (req, res) => {
  if (req.group.settled_at) return res.status(409).json({ error: 'This group is closed' })
  const { value, error } = await readExpenseInput(req, req.group)
  if (error) return res.status(400).json(error)

  const id = uid('exp')
  await db.transaction(async (tx) => {
    await tx.prepare(
      `INSERT INTO expenses (id, group_id, description, category, amount, paid_by, created_by, spent_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(id, req.group.id, value.description, value.category, value.amount, value.paidBy, req.user.id, value.spentAt, now())
    for (const s of value.shares) {
      await tx.prepare('INSERT INTO expense_shares (expense_id, user_id, share) VALUES (?,?,?)')
        .run(id, s.userId, s.share)
    }
  })()

  res.status(201).json({ group: await serializeGroup(req.group) })
})

/** Only the person who logged an expense may edit it (feedback: expense modification). */
groupRoutes.patch('/:id/expenses/:expenseId', loadGroup, async (req, res) => {
  const expense = await db.prepare('SELECT * FROM expenses WHERE id = ? AND group_id = ?')
    .get(req.params.expenseId, req.group.id)
  if (!expense) return res.status(404).json({ error: 'Expense not found' })
  if (expense.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Only the rider who added this expense can edit it' })
  }
  if (req.group.settled_at) return res.status(409).json({ error: 'This group is closed' })

  const { value, error } = await readExpenseInput(req, req.group)
  if (error) return res.status(400).json(error)

  await db.transaction(async (tx) => {
    await tx.prepare(
      `UPDATE expenses SET description=?, category=?, amount=?, paid_by=?, spent_at=?, updated_at=? WHERE id=?`,
    ).run(value.description, value.category, value.amount, value.paidBy, value.spentAt, now(), expense.id)
    await tx.prepare('DELETE FROM expense_shares WHERE expense_id = ?').run(expense.id)
    for (const s of value.shares) {
      await tx.prepare('INSERT INTO expense_shares (expense_id, user_id, share) VALUES (?,?,?)')
        .run(expense.id, s.userId, s.share)
    }
  })()

  res.json({ group: await serializeGroup(req.group) })
})

groupRoutes.delete('/:id/expenses/:expenseId', loadGroup, async (req, res) => {
  const expense = await db.prepare('SELECT * FROM expenses WHERE id = ? AND group_id = ?')
    .get(req.params.expenseId, req.group.id)
  if (!expense) return res.status(404).json({ error: 'Expense not found' })
  if (expense.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Only the rider who added this expense can delete it' })
  }
  await db.prepare('DELETE FROM expenses WHERE id = ?').run(expense.id)
  res.json({ group: await serializeGroup(req.group) })
})

groupRoutes.post('/:id/settlements', loadGroup, async (req, res) => {
  const from = String(req.body?.from ?? '')
  const to = String(req.body?.to ?? '')
  const { paise, error } = parseAmount(req.body?.amount)
  if (error) return res.status(400).json({ error, field: 'amount' })

  const members = await memberIds(req.group.id)
  if (!members.includes(from) || !members.includes(to)) {
    return res.status(400).json({ error: 'Both riders must be in the group' })
  }
  if (from === to) return res.status(400).json({ error: 'Pick two different riders' })

  // Never let a payment overshoot what is actually owed.
  const balances = await computeBalances(req.group.id)
  const owed = -(balances.find((b) => b.id === from)?.net ?? 0)
  if (paise > owed) {
    return res.status(400).json({ error: `That rider only owes ₹${(Math.max(owed, 0) / 100).toFixed(2)}` })
  }

  await db.prepare(
    'INSERT INTO settlements (id, group_id, from_user, to_user, amount, created_at) VALUES (?,?,?,?,?,?)',
  ).run(uid('set'), req.group.id, from, to, paise, now())
  res.status(201).json({ group: await serializeGroup(req.group) })
})

/** Closing a group is only allowed once every member's net position is zero. */
groupRoutes.post('/:id/close', loadGroup, async (req, res) => {
  if (req.group.settled_at) return res.status(409).json({ error: 'This group is already settled' })
  const balances = await computeBalances(req.group.id)
  if (!isGroupSettled(balances)) {
    const outstanding = balances.filter((b) => b.net !== 0).map((b) => b.name).join(', ')
    return res.status(409).json({ error: `Settle up with ${outstanding} before closing the group` })
  }
  await db.prepare('UPDATE groups SET settled_at = ? WHERE id = ?').run(now(), req.group.id)
  const saved = await db.prepare('SELECT * FROM groups WHERE id = ?').get(req.group.id)
  res.json({ group: await serializeGroup(saved) })
})
