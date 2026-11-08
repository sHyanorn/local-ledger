import type { Created, Outcome } from '../../shared/ipc'
import type { Account, AccountFields } from '../../shared/ledger'
import type { Db } from '../vault/database'
import { isDuplicate } from './errors'

export function listAccounts(db: Db): Account[] {
  return db
    .prepare(
      `SELECT a.id, a.name, a.type, a.currency,
         a.opening_balance_cents AS openingBalanceCents,
         a.opening_balance_cents + ifnull(sum(t.amount_cents), 0) AS balanceCents,
         count(t.id) AS transactionCount
       FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
       GROUP BY a.id
       ORDER BY a.name COLLATE NOCASE`,
    )
    .all() as Account[]
}

export function createAccount(
  db: Db,
  fields: AccountFields,
): Created<'duplicate'> {
  try {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO accounts (name, type, currency, opening_balance_cents)
         VALUES (@name, @type, @currency, @openingBalanceCents)`,
      )
      .run(fields)
    return { ok: true, id: Number(lastInsertRowid) }
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, reason: 'duplicate' }
    throw error
  }
}

/**
 * The currency can change only while the account has no transactions,
 * since it would change what their amounts mean.
 */
export function updateAccount(
  db: Db,
  { id, ...fields }: AccountFields & { id: number },
): Outcome<'duplicate' | 'not-found' | 'currency-in-use'> {
  return db.transaction((): ReturnType<typeof updateAccount> => {
    const current = db
      .prepare(
        `SELECT a.currency, count(t.id) AS used
         FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
         WHERE a.id = ? GROUP BY a.id`,
      )
      .get(id) as { currency: string; used: number } | undefined
    if (!current) return { ok: false, reason: 'not-found' }
    if (current.currency !== fields.currency && current.used > 0) {
      return { ok: false, reason: 'currency-in-use' }
    }
    try {
      db.prepare(
        `UPDATE accounts SET name = @name, type = @type, currency = @currency,
           opening_balance_cents = @openingBalanceCents
         WHERE id = @id`,
      ).run({ id, ...fields })
      return { ok: true }
    } catch (error) {
      if (isDuplicate(error)) return { ok: false, reason: 'duplicate' }
      throw error
    }
  })()
}

/** Only an account without transactions can be deleted. */
export function deleteAccount(
  db: Db,
  id: number,
): Outcome<'in-use' | 'not-found'> {
  return db.transaction((): ReturnType<typeof deleteAccount> => {
    const used = db
      .prepare('SELECT count(*) FROM transactions WHERE account_id = ?')
      .pluck()
      .get(id) as number
    if (used > 0) return { ok: false, reason: 'in-use' }
    const { changes } = db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
    return changes > 0 ? { ok: true } : { ok: false, reason: 'not-found' }
  })()
}
