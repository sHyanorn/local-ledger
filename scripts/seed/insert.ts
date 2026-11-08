// Writes a generated ledger into an open, empty database.
import { createAccount } from '../../src/main/ledger/accounts'
import { createCategory } from '../../src/main/ledger/categories'
import { pairTransfers } from '../../src/main/ledger/transfers'
import type { Db } from '../../src/main/vault/database'
import type { SeedLedger } from './generate'

export function insertLedger(db: Db, ledger: SeedLedger): void {
  db.transaction(() => {
    const accounts = new Map<string, number>()
    for (const fields of ledger.accounts) {
      const result = createAccount(db, fields)
      if (!result.ok)
        throw new Error(`account ${fields.name}: ${result.reason}`)
      accounts.set(fields.name, result.id)
    }
    const categories = new Map<string, number>()
    const category = (name: string, parentId: number | null, path: string) => {
      const result = createCategory(db, { name, parentId })
      if (!result.ok) throw new Error(`category ${path}: ${result.reason}`)
      categories.set(path, result.id)
      return result.id
    }
    for (const parent of ledger.categories) {
      const parentId = category(parent.name, null, parent.name)
      for (const child of parent.children) {
        category(child, parentId, `${parent.name}/${child}`)
      }
    }
    const insert = db.prepare(
      `INSERT INTO transactions
         (account_id, date, amount_cents, description, category_id, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const row of ledger.transactions) {
      const accountId = accounts.get(row.account)
      const categoryId =
        row.category === null ? null : categories.get(row.category)
      if (accountId === undefined || categoryId === undefined) {
        throw new Error(`unknown account or category in ${row.description}`)
      }
      insert.run(
        accountId,
        row.date,
        row.amountCents,
        row.description,
        categoryId,
        row.notes === '' ? null : row.notes,
      )
    }
    // Transfers and card repayments pair as an import would pair them.
    pairTransfers(db)
  })()
}
