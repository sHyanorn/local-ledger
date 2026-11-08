// A transfer between two of the user's accounts appears once in each: money
// out of one, the same money into the other. Paired, the two are one
// transfer, which reports leave out of income and spending.
//
// Two transactions may pair when they are in different accounts of one
// currency, their amounts are exactly opposite, they are dated at most
// TRANSFER_DAYS apart, and neither is paired already. On import they pair on
// their own when each is the other's one candidate; every other candidate,
// and any that edits or decisions leave, waits for the user. A pair the user
// splits or turns down is remembered and not offered again.
import type { Outcome } from '../../shared/ipc'
import {
  TRANSFER_DAYS,
  type PossibleTransfer,
  type TransferSide,
} from '../../shared/transfers'
import type { Db } from '../vault/database'

interface Candidate {
  outId: number
  inId: number
  days: number
  outBatch: number | null
  inBatch: number | null
}

function candidates(db: Db): Candidate[] {
  return db
    .prepare(
      `SELECT o.id AS outId, i.id AS inId,
         abs(julianday(i.date) - julianday(o.date)) AS days,
         o.import_batch_id AS outBatch, i.import_batch_id AS inBatch
       FROM transactions o
       JOIN accounts ao ON ao.id = o.account_id
       JOIN transactions i
         ON i.amount_cents = -o.amount_cents
         AND i.date BETWEEN date(o.date, '-${TRANSFER_DAYS} days')
                        AND date(o.date, '+${TRANSFER_DAYS} days')
         AND i.account_id <> o.account_id
       JOIN accounts ai ON ai.id = i.account_id AND ai.currency = ao.currency
       WHERE o.amount_cents < 0
         AND o.id NOT IN (SELECT id FROM transfer_members)
         AND i.id NOT IN (SELECT id FROM transfer_members)
         AND NOT EXISTS (
           SELECT 1 FROM transfer_links l
           WHERE l.out_id = o.id AND l.in_id = i.id AND l.status = 'rejected')
       ORDER BY o.date, o.id, i.id`,
    )
    .all() as Candidate[]
}

/**
 * The pairs that are sure. Candidates that share a transaction form a group;
 * a group of one pair is sure. In a larger group, as when equal transfers
 * recur within days of each other, the same-day pairs are sure only if they
 * account for every transaction in the group, one partner each; otherwise
 * the whole group waits for the user.
 */
function unique(all: readonly Candidate[]): Candidate[] {
  const parent = new Map<number, number>()
  const root = (id: number): number => {
    const up = parent.get(id) ?? id
    if (up === id) return id
    const top = root(up)
    parent.set(id, top)
    return top
  }
  for (const { outId, inId } of all) parent.set(root(outId), root(inId))

  const groups = new Map<number, Candidate[]>()
  for (const pair of all) {
    const key = root(pair.outId)
    groups.set(key, [...(groups.get(key) ?? []), pair])
  }
  const sure: Candidate[] = []
  for (const pairs of groups.values()) {
    if (pairs.length === 1) {
      sure.push(...pairs)
      continue
    }
    const members = new Set(pairs.flatMap((pair) => [pair.outId, pair.inId]))
    const sameDay = pairs.filter((pair) => pair.days === 0)
    const partners = new Map<number, number>()
    for (const pair of sameDay) {
      for (const id of [pair.outId, pair.inId]) {
        partners.set(id, (partners.get(id) ?? 0) + 1)
      }
    }
    const everyOnce = [...members].every((id) => partners.get(id) === 1)
    if (everyOnce) sure.push(...sameDay)
  }
  return sure
}

const confirm = (db: Db, outId: number, inId: number) =>
  db
    .prepare(
      `INSERT INTO transfer_links (out_id, in_id, status)
       VALUES (?, ?, 'confirmed')
       ON CONFLICT (out_id, in_id) DO UPDATE SET status = 'confirmed'`,
    )
    .run(outId, inId)

/**
 * Pairs the transfers that have one candidate (see `unique`); with a batch,
 * only those with a side in it, so an import never pairs older rows alone.
 * Returns how many.
 */
export function pairTransfers(db: Db, batchId?: number): number {
  return db.transaction(() => {
    const sure = unique(candidates(db)).filter(
      (pair) =>
        batchId === undefined ||
        pair.outBatch === batchId ||
        pair.inBatch === batchId,
    )
    for (const pair of sure) confirm(db, pair.outId, pair.inId)
    return sure.length
  })()
}

/** How many pairs wait for the user, for the sidebar. */
export function countPossibleTransfers(db: Db): number {
  return candidates(db).length
}

const SIDE = `id, account_id AS accountId, date, amount_cents AS amountCents,
  description`

/** Every pair that could be a transfer and is not decided, for the user. */
export function possibleTransfers(db: Db): PossibleTransfer[] {
  const side = db.prepare(`SELECT ${SIDE} FROM transactions WHERE id = ?`)
  return candidates(db).map((pair) => ({
    out: side.get(pair.outId) as TransferSide,
    in: side.get(pair.inId) as TransferSide,
  }))
}

/**
 * Transactions this one could pair with by hand: the opposite amount in
 * another account of its currency, not paired yet, nearest date first.
 */
export function transferChoices(db: Db, id: number): TransferSide[] {
  return db
    .prepare(
      `SELECT c.id, c.account_id AS accountId, c.date,
         c.amount_cents AS amountCents, c.description
       FROM transactions t
       JOIN accounts at ON at.id = t.account_id
       JOIN transactions c ON c.amount_cents = -t.amount_cents
         AND c.account_id <> t.account_id
       JOIN accounts ac ON ac.id = c.account_id AND ac.currency = at.currency
       WHERE t.id = ? AND t.amount_cents <> 0
         AND t.id NOT IN (SELECT id FROM transfer_members)
         AND c.id NOT IN (SELECT id FROM transfer_members)
       ORDER BY abs(julianday(c.date) - julianday(t.date)), c.id
       LIMIT 20`,
    )
    .all(id) as TransferSide[]
}

/** Pairs two transactions by hand, when they can be one transfer. */
export function linkTransfer(
  db: Db,
  id: number,
  otherId: number,
): Outcome<'not-found' | 'not-a-pair'> {
  return db.transaction((): Outcome<'not-found' | 'not-a-pair'> => {
    const side = db.prepare(
      `SELECT t.amount_cents AS cents, t.account_id AS accountId, a.currency,
         t.id IN (SELECT id FROM transfer_members) AS paired
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.id = ?`,
    )
    type Side = {
      cents: number
      accountId: number
      currency: string
      paired: number
    }
    const a = side.get(id) as Side | undefined
    const b = side.get(otherId) as Side | undefined
    if (!a || !b) return { ok: false, reason: 'not-found' }
    if (
      a.cents === 0 ||
      a.cents !== -b.cents ||
      a.accountId === b.accountId ||
      a.currency !== b.currency ||
      a.paired ||
      b.paired
    ) {
      return { ok: false, reason: 'not-a-pair' }
    }
    if (a.cents < 0) confirm(db, id, otherId)
    else confirm(db, otherId, id)
    return { ok: true }
  })()
}

/** Splits the transfer this transaction is part of, and remembers not to pair them again. */
export function unlinkTransfer(db: Db, id: number): Outcome<'not-found'> {
  const { changes } = db
    .prepare(
      `UPDATE transfer_links SET status = 'rejected'
       WHERE status = 'confirmed' AND (out_id = ? OR in_id = ?)`,
    )
    .run(id, id)
  return changes > 0 ? { ok: true } : { ok: false, reason: 'not-found' }
}

/** Records that two transactions are not a transfer, so they are not offered again. */
export function rejectTransfer(
  db: Db,
  outId: number,
  inId: number,
): Outcome<'not-found'> {
  const exists = db.prepare('SELECT 1 FROM transactions WHERE id = ?')
  if (!exists.get(outId) || !exists.get(inId) || outId === inId) {
    return { ok: false, reason: 'not-found' }
  }
  db.prepare(
    `INSERT INTO transfer_links (out_id, in_id, status) VALUES (?, ?, 'rejected')
     ON CONFLICT (out_id, in_id) DO NOTHING`,
  ).run(outId, inId)
  return { ok: true }
}
