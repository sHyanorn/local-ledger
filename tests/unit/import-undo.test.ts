// Undoing an import keeps the transactions a later import also held.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listBatches, undoBatch } from '../../src/main/import/batches'
import { ImportSession } from '../../src/main/import/session'
import { createAccount } from '../../src/main/ledger/accounts'
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from '../../src/main/ledger/transactions'
import type { Db } from '../../src/main/vault/database'
import type { RowStatus } from '../../src/shared/imports'
import { tempDatabase, type TempDatabase } from '../support/temp-database'

let temp: TempDatabase
let db: Db
let everyday: number
beforeEach(() => {
  temp = tempDatabase('ledger-undo-')
  db = temp.db
  everyday = account('Fake Everyday')
})
afterEach(() => temp.dispose())

function account(name: string): number {
  const created = createAccount(db, {
    name,
    type: 'bank',
    currency: 'AUD',
    openingBalanceCents: 0,
  })
  if (!created.ok) throw new Error('no account')
  return created.id
}

/** A file with one fake purchase on each of these days of February. */
const days = (...list: number[]) =>
  list
    .map(
      (day) =>
        `2026-02-${String(day).padStart(2, '0')},-${day}.00,Fake Shop ${day}`,
    )
    .join('\n')

/** Imports a file's new rows, and the possible ones that `keep` allows. */
function importFile(
  name: string,
  lines: string,
  accountId = everyday,
  keep: (status: RowStatus) => boolean = (status) => status === 'new',
) {
  const session = new ImportSession()
  const opened = session.open(
    db,
    name,
    new TextEncoder().encode(`Date,Amount,Description\n${lines}`),
  )
  if (!opened.ok) throw new Error(opened.reason)
  const request = {
    id: opened.file.id,
    encoding: opened.file.encoding,
    mapping: opened.file.mapping!,
    targets: [{ key: '', accountId }],
  }
  const preview = session.preview(db, request)
  if (!preview.ok) throw new Error(preview.reason)
  const { rows } = preview.preview
  const done = session.commit(db, {
    ...request,
    selected: rows.filter((row) => keep(row.status)).map((row) => row.index),
  })
  if (!done.ok) throw new Error(done.reason)
  return { ...done, statuses: rows.map((row) => row.status) }
}

const ledger = () =>
  db
    .prepare(
      `SELECT CAST(substr(date, 9) AS INTEGER) AS day, import_batch_id AS batch
       FROM transactions ORDER BY date, id`,
    )
    .all() as { day: number; batch: number | null }[]
const daysLeft = () => ledger().map((row) => row.day)
const skips = () =>
  db.prepare('SELECT count(*) FROM import_skips').pluck().get() as number
const batch = (id: number) => listBatches(db).find((entry) => entry.id === id)

describe('undoing an import', () => {
  it('keeps the rows a later import left out as duplicates', () => {
    const first = importFile('first.csv', days(1, 2, 3, 4, 5))
    const second = importFile('second.csv', days(4, 5, 6, 7))
    expect([first.count, second.count]).toEqual([5, 2])
    expect(batch(first.id)).toMatchObject({ count: 5, kept: 2 })
    expect(batch(second.id)).toMatchObject({ count: 2, kept: 0 })

    expect(undoBatch(db, first.id)).toEqual({ ok: true, count: 3, kept: 2 })
    // Everything second.csv holds is in the ledger, as its import.
    expect(ledger()).toEqual(
      [4, 5, 6, 7].map((day) => ({ day, batch: second.id })),
    )
    expect(batch(second.id)).toMatchObject({ count: 4, kept: 0 })
    expect(skips()).toBe(0)

    expect(undoBatch(db, second.id)).toEqual({ ok: true, count: 4, kept: 0 })
    expect(ledger()).toEqual([])
    expect(listBatches(db)).toEqual([])
  })

  it('hands a row on from import to import while any still holds it', () => {
    const a = importFile('a.csv', days(1, 2, 3, 4, 5))
    const b = importFile('b.csv', days(4, 5, 6, 7))
    const c = importFile('c.csv', days(5, 7, 8))
    expect(batch(a.id)).toMatchObject({ count: 5, kept: 2 })
    expect(batch(b.id)).toMatchObject({ count: 2, kept: 1 })

    expect(undoBatch(db, a.id)).toEqual({ ok: true, count: 3, kept: 2 })
    expect(daysLeft()).toEqual([4, 5, 6, 7, 8])
    expect(batch(b.id)).toMatchObject({ count: 4, kept: 2 })

    expect(undoBatch(db, b.id)).toEqual({ ok: true, count: 2, kept: 2 })
    expect(ledger()).toEqual([5, 7, 8].map((day) => ({ day, batch: c.id })))

    expect(undoBatch(db, c.id)).toEqual({ ok: true, count: 3, kept: 0 })
    expect(ledger()).toEqual([])
    expect(skips()).toBe(0)
  })

  it('deletes everything once the later import was undone first', () => {
    const first = importFile('first.csv', days(1, 2, 3, 4, 5))
    const second = importFile('second.csv', days(4, 5, 6, 7))
    expect(skips()).toBe(2)
    expect(undoBatch(db, second.id)).toEqual({ ok: true, count: 2, kept: 0 })
    expect(skips()).toBe(0)
    expect(batch(first.id)).toMatchObject({ count: 5, kept: 0 })
    expect(undoBatch(db, first.id)).toEqual({ ok: true, count: 5, kept: 0 })
    expect(ledger()).toEqual([])
  })

  it('keeps a row the user left out of a later import as already there', () => {
    const first = importFile('first.csv', days(1, 2))
    // The same purchase a day later, under a longer description.
    const again = '2026-02-03,-2.00,Fake Shop 2 Card 1234\n' + days(6)
    const second = importFile('second.csv', again)
    expect(second.statuses).toEqual(['possible', 'new'])
    expect(second.count).toBe(1)
    expect(batch(first.id)).toMatchObject({ count: 2, kept: 1 })
    expect(undoBatch(db, first.id)).toEqual({ ok: true, count: 1, kept: 1 })
    expect(daysLeft()).toEqual([2, 6])
  })

  it('keeps nothing for a possible match the user imported as new', () => {
    const first = importFile('first.csv', days(1, 2))
    importFile(
      'second.csv',
      '2026-02-03,-2.00,Fake Shop 2 Card 1234',
      everyday,
      () => true,
    )
    expect(skips()).toBe(0)
    expect(undoBatch(db, first.id)).toEqual({ ok: true, count: 2, kept: 0 })
    expect(daysLeft()).toEqual([3])
  })

  it('records nothing for rows that match a transaction entered by hand', () => {
    createTransaction(db, {
      accountId: everyday,
      date: '2026-02-02',
      amountCents: -200,
      description: 'Fake Shop 2',
      categoryId: null,
      notes: '',
    })
    const imported = importFile('first.csv', days(1, 2))
    expect(imported.statuses).toEqual(['new', 'possible'])
    expect(skips()).toBe(0)
  })

  it('forgets a kept row the user deletes', () => {
    const first = importFile('first.csv', days(1, 2))
    importFile('second.csv', days(2, 3))
    const { id } = db
      .prepare("SELECT id FROM transactions WHERE date = '2026-02-02'")
      .get() as { id: number }
    deleteTransaction(db, id)
    expect(skips()).toBe(0)
    expect(batch(first.id)).toMatchObject({ count: 1, kept: 0 })
  })

  it('forgets a kept row the user moves to another account', () => {
    const first = importFile('first.csv', days(1, 2, 3))
    importFile('second.csv', days(3, 4))
    const kept = db
      .prepare(
        `SELECT id, account_id AS accountId, date, amount_cents AS amountCents,
           description, category_id AS categoryId
         FROM transactions WHERE date = '2026-02-03'`,
      )
      .get() as Parameters<typeof updateTransaction>[1]
    // Another edit leaves it held.
    updateTransaction(db, { ...kept, notes: 'fake note' })
    expect(skips()).toBe(1)

    const savings = account('Fake Savings')
    updateTransaction(db, { ...kept, notes: '', accountId: savings })
    expect(skips()).toBe(0)
    // It is no longer second.csv's row, which is new again.
    expect(importFile('second.csv', days(3, 4)).count).toBe(1)
    expect(undoBatch(db, first.id)).toEqual({ ok: true, count: 3, kept: 0 })
    expect(daysLeft()).toEqual([3, 4])
  })

  it('leaves a kept row paired as a transfer, and counts only what it deletes', () => {
    const savings = account('Fake Savings')
    createTransaction(db, {
      accountId: savings,
      date: '2026-02-05',
      amountCents: 500,
      description: 'Fake From Everyday',
      categoryId: null,
      notes: '',
    })
    const links = () =>
      db.prepare('SELECT count(*) FROM transfer_members').pluck().get()
    const first = importFile('first.csv', days(1, 5))
    expect(first.paired).toBe(1)
    db.prepare(
      'UPDATE transactions SET edited = 1 WHERE import_batch_id = ?',
    ).run(first.id)
    expect(batch(first.id)).toMatchObject({ count: 2, edited: 2, paired: 1 })

    const second = importFile('second.csv', days(5, 6))
    expect(batch(first.id)).toMatchObject({
      count: 2,
      kept: 1,
      edited: 1,
      paired: 0,
    })
    expect(undoBatch(db, first.id)).toEqual({ ok: true, count: 1, kept: 1 })
    expect(links()).toBe(2)
    expect(batch(second.id)).toMatchObject({ count: 2, edited: 1, paired: 1 })

    expect(undoBatch(db, second.id)).toEqual({ ok: true, count: 2, kept: 0 })
    expect(links()).toBe(0)
  })
})
