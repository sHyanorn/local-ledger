// Transactions newest first, a page at a time. Pages continue from the last
// row shown (keyset paging), so a page costs the same however deep it is.
import type { Created, Outcome } from '../../shared/ipc'
import type {
  CurrencyTotal,
  TransactionCursor,
  TransactionFields,
  TransactionFilter,
  TransactionPage,
} from '../../shared/ledger'
import type { Db } from '../vault/database'
import { isMissingReference } from './errors'

const COLUMNS = `t.id, t.account_id AS accountId, t.date,
  t.amount_cents AS amountCents, t.description,
  t.category_id AS categoryId, ifnull(t.notes, '') AS notes, a.currency,
  other.account_id AS transferAccountId`

/** The other side of a transaction's transfer, when it has one. */
const TRANSFER_JOIN = `
  LEFT JOIN transfer_links lo ON lo.out_id = t.id AND lo.status = 'confirmed'
  LEFT JOIN transfer_links li ON li.in_id = t.id AND li.status = 'confirmed'
  LEFT JOIN transactions other ON other.id = coalesce(lo.in_id, li.out_id)`

/** LIKE treats % and _ as wildcards; a search means them literally. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&')

function where(
  filter: TransactionFilter,
  after?: TransactionCursor,
): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  if (filter.accountId !== undefined) {
    clauses.push('t.account_id = ?')
    params.push(filter.accountId)
  }
  if (filter.category === 'none') {
    // A transfer needs no category, so it is not left to categorize.
    clauses.push(
      't.category_id IS NULL AND t.id NOT IN (SELECT id FROM transfer_members)',
    )
  } else if (filter.category !== undefined) {
    clauses.push(
      't.category_id IN (SELECT id FROM categories WHERE id = ? OR parent_id = ?)',
    )
    params.push(filter.category, filter.category)
  }
  if (filter.from !== undefined) {
    clauses.push('t.date >= ?')
    params.push(filter.from)
  }
  if (filter.to !== undefined) {
    clauses.push('t.date <= ?')
    params.push(filter.to)
  }
  const text = filter.text?.trim()
  if (text) {
    const pattern = `%${escapeLike(text)}%`
    clauses.push(
      "(t.description LIKE ? ESCAPE '\\' OR ifnull(t.notes, '') LIKE ? ESCAPE '\\')",
    )
    params.push(pattern, pattern)
  }
  if (after) {
    clauses.push('(t.date, t.id) < (?, ?)')
    params.push(after.date, after.id)
  }
  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  }
}

export function pageTransactions(
  db: Db,
  {
    filter,
    after,
    limit,
  }: { filter: TransactionFilter; after?: TransactionCursor; limit: number },
): TransactionPage {
  const { sql, params } = where(filter, after)
  // One row more than asked tells whether another page follows.
  const rows = db
    .prepare(
      `SELECT ${COLUMNS}
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       ${TRANSFER_JOIN}
       ${sql}
       ORDER BY t.date DESC, t.id DESC
       LIMIT ?`,
    )
    .all(...params, limit + 1) as TransactionPage['rows']
  const more = rows.length > limit
  if (more) rows.pop()
  const last = rows.at(-1)
  return {
    rows,
    next: more && last ? { date: last.date, id: last.id } : null,
  }
}

/** Totals of the matching transactions, one per currency. */
export function totalTransactions(
  db: Db,
  filter: TransactionFilter,
): CurrencyTotal[] {
  const { sql, params } = where(filter)
  return db
    .prepare(
      `SELECT a.currency, count(*) AS count, sum(t.amount_cents) AS cents
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       ${sql}
       GROUP BY a.currency
       ORDER BY a.currency`,
    )
    .all(...params) as CurrencyTotal[]
}

const row = (fields: TransactionFields) => ({
  ...fields,
  notes: fields.notes === '' ? null : fields.notes,
})

/** Fails with not-found when the account or category is gone. */
export function createTransaction(
  db: Db,
  fields: TransactionFields,
): Created<'not-found'> {
  try {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO transactions
           (account_id, date, amount_cents, description, category_id, notes)
         VALUES (@accountId, @date, @amountCents, @description, @categoryId, @notes)`,
      )
      .run(row(fields))
    return { ok: true, id: Number(lastInsertRowid) }
  } catch (error) {
    if (isMissingReference(error)) return { ok: false, reason: 'not-found' }
    throw error
  }
}

export function updateTransaction(
  db: Db,
  { id, ...fields }: TransactionFields & { id: number },
): Outcome<'not-found'> {
  try {
    const values = { id, ...row(fields) }
    // A new amount or account means it is no longer that transfer.
    const unpair = db.prepare(
      `DELETE FROM transfer_links
       WHERE status = 'confirmed' AND (out_id = @id OR in_id = @id)
         AND EXISTS (
           SELECT 1 FROM transactions WHERE id = @id
             AND (amount_cents IS NOT @amountCents
               OR account_id IS NOT @accountId))`,
    )
    const update = db.prepare(
      `UPDATE transactions SET account_id = @accountId, date = @date,
           amount_cents = @amountCents, description = @description,
           category_id = @categoryId, notes = @notes,
           -- A fingerprint belongs to its account's imports.
           hash = CASE WHEN account_id IS @accountId THEN hash END,
           edited = edited OR account_id IS NOT @accountId
             OR date IS NOT @date OR amount_cents IS NOT @amountCents
             OR description IS NOT @description
             OR category_id IS NOT @categoryId OR notes IS NOT @notes
         WHERE id = @id`,
    )
    const { changes } = db.transaction(() => {
      unpair.run(values)
      return update.run(values)
    })()
    return changes > 0 ? { ok: true } : { ok: false, reason: 'not-found' }
  } catch (error) {
    if (isMissingReference(error)) return { ok: false, reason: 'not-found' }
    throw error
  }
}

export function setTransactionCategory(
  db: Db,
  id: number,
  categoryId: number | null,
): Outcome<'not-found'> {
  try {
    const { changes } = db
      .prepare(
        `UPDATE transactions SET category_id = @categoryId,
           edited = edited OR category_id IS NOT @categoryId
         WHERE id = @id`,
      )
      .run({ id, categoryId })
    return changes > 0 ? { ok: true } : { ok: false, reason: 'not-found' }
  } catch (error) {
    if (isMissingReference(error)) return { ok: false, reason: 'not-found' }
    throw error
  }
}

export function deleteTransaction(db: Db, id: number): Outcome<'not-found'> {
  const { changes } = db
    .prepare('DELETE FROM transactions WHERE id = ?')
    .run(id)
  return changes > 0 ? { ok: true } : { ok: false, reason: 'not-found' }
}
