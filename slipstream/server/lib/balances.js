import { db } from './db.js'

/**
 * Net position per member, in paise.
 *   positive  -> the group owes them (they paid more than their share)
 *   negative  -> they owe the group
 * Recorded settlements move money back, so a fully settled group is all zeroes.
 */
export async function computeBalances(groupId) {
  const members = await db
    .prepare(
      `SELECT u.id, u.name, u.avatar_color AS "avatarColor"
         FROM group_members gm JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = ?
        ORDER BY gm.seq`,
    )
    .all(groupId)

  const net = new Map(members.map((m) => [m.id, 0]))
  const bump = (id, delta) => { if (net.has(id)) net.set(id, net.get(id) + delta) }

  const expenses = await db.prepare('SELECT id, paid_by, amount FROM expenses WHERE group_id = ?').all(groupId)
  for (const e of expenses) {
    bump(e.paid_by, e.amount)
    const shares = await db.prepare('SELECT user_id, share FROM expense_shares WHERE expense_id = ?').all(e.id)
    for (const s of shares) bump(s.user_id, -s.share)
  }

  const settlements = await db.prepare('SELECT from_user, to_user, amount FROM settlements WHERE group_id = ?').all(groupId)
  for (const s of settlements) {
    // Paying down a debt moves the payer toward zero from below.
    bump(s.from_user, s.amount)
    bump(s.to_user, -s.amount)
  }

  return members.map((m) => ({ ...m, net: net.get(m.id) ?? 0 }))
}

/**
 * Greedy largest-creditor/largest-debtor pairing. Not provably minimal in
 * every case, but it always clears the group and never suggests more than
 * (members - 1) transfers, which is what matters in a ride group.
 */
export function suggestSettlements(balances) {
  const debtors = balances.filter((b) => b.net < 0).map((b) => ({ ...b })).sort((a, b) => a.net - b.net)
  const creditors = balances.filter((b) => b.net > 0).map((b) => ({ ...b })).sort((a, b) => b.net - a.net)

  const transfers = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(-debtors[i].net, creditors[j].net)
    if (amount > 0) {
      transfers.push({
        from: { id: debtors[i].id, name: debtors[i].name },
        to: { id: creditors[j].id, name: creditors[j].name },
        amount,
      })
      debtors[i].net += amount
      creditors[j].net -= amount
    }
    if (debtors[i].net === 0) i++
    if (creditors[j].net === 0) j++
  }
  return transfers
}

export const isGroupSettled = (balances) => balances.every((b) => b.net === 0)

/**
 * Splits `total` paise across userIds. Integer division leaves a remainder of
 * up to (n-1) paise; handing one extra paisa to the first few keeps the shares
 * summing to exactly the total instead of silently losing a rupee fraction.
 */
export function splitEvenly(total, userIds) {
  const n = userIds.length
  if (n === 0) return []
  const base = Math.floor(total / n)
  let remainder = total - base * n
  return userIds.map((id) => {
    const extra = remainder > 0 ? 1 : 0
    remainder -= extra
    return { userId: id, share: base + extra }
  })
}
