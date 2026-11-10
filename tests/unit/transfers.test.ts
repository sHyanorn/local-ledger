import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listBatches, undoBatch } from '../../src/main/import/batches'
import { ImportSession } from '../../src/main/import/session'
import { createAccount } from '../../src/main/ledger/accounts'
import { createCategory } from '../../src/main/ledger/categories'
import { createRule } from '../../src/main/ledger/rules'
import {
  createTransaction,
  deleteTransaction,
  pageTransactions,
  updateTransaction,
} from '../../src/main/ledger/transactions'
import {
  linkTransfer,
  pairTransfers,
  possibleTransfers,
  rejectTransfer,
  transferChoices,
  unlinkTransfer,
} from '../../src/main/ledger/transfers'
import type { Db } from '../../src/main/vault/database'
import { generateLedger } from '../../scripts/seed/generate'
import { insertLedger } from '../../scripts/seed/insert'
import { tempDatabase, type TempDatabase } from '../support/temp-database'
import { previewAndCommit } from '../support/import'

let temp: TempDatabase
let db: Db
let everyday: number
let savings: number
let travel: number
beforeEach(() => {
  temp = tempDatabase('ledger-transfers-')
  db = temp.db
  const account = (name: string, currency: 'AUD' | 'CNY' = 'AUD') => {
    const result = createAccount(db, {
      name,
      type: 'bank',
      currency,
      openingBalanceCents: 0,
    })
    if (!result.ok) throw new Error('no account')
    return result.id
  }
  everyday = account('Fake Everyday')
  savings = account('Fake Savings')
  travel = account('Fake Travel', 'CNY')
})
afterEach(() => temp.dispose())

const add = (
  accountId: number,
  date: string,
  amountCents: number,
  description = 'Fake Transfer',
) => {
  const result = createTransaction(db, {
    accountId,
    date,
    amountCents,
    description,
    categoryId: null,
    notes: '',
  })
  if (!result.ok) throw new Error('no transaction')
  return result.id
}
const card = () => {
  const result = createAccount(db, {
    name: 'Fake Card',
    type: 'credit',
    currency: 'AUD',
    openingBalanceCents: 0,
  })
  if (!result.ok) throw new Error('no account')
  return result.id
}
const links = () =>
  db
    .prepare(
      'SELECT out_id AS outId, in_id AS inId, status FROM transfer_links ORDER BY out_id, in_id',
    )
    .all() as { outId: number; inId: number; status: string }[]
const reported = () =>
  (
    db.prepare('SELECT id FROM report_transactions ORDER BY id').all() as {
      id: number
    }[]
  ).map((row) => row.id)

describe('pairing', () => {
  it('pairs opposite amounts in two accounts up to four days apart', () => {
    const out = add(everyday, '2026-05-01', -100000)
    const into = add(savings, '2026-05-05', 100000)
    expect(pairTransfers(db)).toBe(1)
    expect(links()).toEqual([{ outId: out, inId: into, status: 'confirmed' }])
    expect(pairTransfers(db)).toBe(0)
  })

  it('leaves alone dates five days apart, one account, other currencies and other amounts', () => {
    add(everyday, '2026-05-01', -100000)
    add(savings, '2026-05-06', 100000)
    add(everyday, '2026-05-01', 100000)
    add(travel, '2026-05-01', 100000)
    add(savings, '2026-05-01', 99999)
    expect(pairTransfers(db)).toBe(0)
    expect(possibleTransfers(db)).toEqual([])
  })

  it('lists a sure pair for review until something pairs it', () => {
    const out = add(everyday, '2026-05-01', -100000)
    const into = add(savings, '2026-05-02', 100000)
    expect(
      possibleTransfers(db).map((pair) => [pair.out.id, pair.in.id]),
    ).toEqual([[out, into]])
    pairTransfers(db)
    expect(possibleTransfers(db)).toEqual([])
  })

  it('pairs recurring equal transfers on the day each happens', () => {
    const days = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04']
    const pairs = days.map((date) => [
      add(everyday, date, -500),
      add(savings, date, 500),
    ])
    expect(pairTransfers(db)).toBe(4)
    expect(links().map((link) => [link.outId, link.inId])).toEqual(pairs)
  })

  it('leaves recurring transfers that arrive a day later for review', () => {
    const days = [
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
    ]
    for (const date of days) add(everyday, date, -500)
    for (const date of days) {
      add(savings, `2026-05-0${Number(date.slice(-1)) + 1}`, 500)
    }
    expect(pairTransfers(db)).toBe(0)
    expect(possibleTransfers(db).length).toBeGreaterThan(0)
  })

  it('does not pair a same-day refund over the real transfer a day later', () => {
    add(everyday, '2026-05-01', -5000)
    add(savings, '2026-05-02', 5000, 'Fake Real Transfer')
    add(card(), '2026-05-01', 5000, 'Fake Refund')
    expect(pairTransfers(db)).toBe(0)
    expect(possibleTransfers(db)).toHaveLength(2)
  })

  it('waits when only the money in has another candidate', () => {
    add(everyday, '2026-05-01', -5000)
    add(everyday, '2026-05-02', -5000, 'Fake Other Out')
    add(savings, '2026-05-03', 5000)
    expect(pairTransfers(db)).toBe(0)
  })

  it('looks four days before as well as after', () => {
    add(everyday, '2026-05-05', -5000)
    add(savings, '2026-05-01', 5000)
    expect(pairTransfers(db)).toBe(1)
    add(everyday, '2026-05-15', -7000)
    add(savings, '2026-05-10', 7000)
    expect(pairTransfers(db)).toBe(0)
  })

  it('waits for the user when either side has another candidate', () => {
    const out = add(everyday, '2026-05-01', -5000)
    const first = add(savings, '2026-05-02', 5000)
    const second = add(savings, '2026-05-03', 5000)
    expect(pairTransfers(db)).toBe(0)
    expect(
      possibleTransfers(db).map((pair) => [pair.out.id, pair.in.id]),
    ).toEqual([
      [out, first],
      [out, second],
    ])
    expect(possibleTransfers(db)[0]?.out).toEqual({
      id: out,
      accountId: everyday,
      date: '2026-05-01',
      amountCents: -5000,
      description: 'Fake Transfer',
    })

    expect(linkTransfer(db, second, out)).toEqual({ ok: true })
    expect(links()).toEqual([{ outId: out, inId: second, status: 'confirmed' }])
    expect(possibleTransfers(db)).toEqual([])
  })

  it('does not offer a pair again once rejected or split', () => {
    const out = add(everyday, '2026-05-01', -5000)
    const first = add(savings, '2026-05-01', 5000)
    const second = add(savings, '2026-05-02', 5000)
    expect(rejectTransfer(db, out, first)).toEqual({ ok: true })
    // The other candidate is now the only one.
    expect(pairTransfers(db)).toBe(1)
    expect(unlinkTransfer(db, second)).toEqual({ ok: true })
    expect(pairTransfers(db)).toBe(0)
    expect(links()).toEqual([
      { outId: out, inId: first, status: 'rejected' },
      { outId: out, inId: second, status: 'rejected' },
    ])
    expect(unlinkTransfer(db, second)).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(rejectTransfer(db, out, 999)).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it('pairs by hand only what could be one transfer', () => {
    const out = add(everyday, '2026-01-01', -5000)
    const late = add(savings, '2026-03-01', 5000)
    const same = add(everyday, '2026-01-01', 5000)
    const other = add(travel, '2026-01-01', 5000)
    const odd = add(savings, '2026-01-01', 4999)
    expect(transferChoices(db, out).map((side) => side.id)).toEqual([late])
    for (const id of [same, other, odd]) {
      expect(linkTransfer(db, out, id)).toEqual({
        ok: false,
        reason: 'not-a-pair',
      })
    }
    expect(linkTransfer(db, out, 999)).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(linkTransfer(db, out, late)).toEqual({ ok: true })
    expect(transferChoices(db, out)).toEqual([])
    // A side already paired is not offered to another transaction.
    const another = add(everyday, '2026-03-01', -5000)
    expect(transferChoices(db, another)).toEqual([])
    const again = add(savings, '2026-01-02', 5000)
    expect(linkTransfer(db, out, again)).toEqual({
      ok: false,
      reason: 'not-a-pair',
    })
  })
})

describe('a pair in the ledger', () => {
  it('is left out of reports and of the uncategorized filter', () => {
    const out = add(everyday, '2026-05-01', -5000)
    const into = add(savings, '2026-05-01', 5000)
    const spend = add(everyday, '2026-05-02', -700, 'Fake Shop')
    pairTransfers(db)
    expect(reported()).toEqual([spend])
    const page = pageTransactions(db, { filter: {}, limit: 10 })
    expect(page.rows.map((row) => [row.id, row.transferAccountId])).toEqual([
      [spend, null],
      [into, everyday],
      [out, savings],
    ])
    expect(
      pageTransactions(db, {
        filter: { category: 'none' },
        limit: 10,
      }).rows.map((row) => row.id),
    ).toEqual([spend])
    unlinkTransfer(db, out)
    expect(reported()).toEqual([out, into, spend])
  })

  it('comes apart when an amount or account changes, or a side is deleted', () => {
    const out = add(everyday, '2026-05-01', -5000)
    const into = add(savings, '2026-05-01', 5000)
    pairTransfers(db)
    const fields = {
      id: out,
      accountId: everyday,
      date: '2026-05-02',
      amountCents: -5000,
      description: 'Renamed',
      categoryId: null,
      notes: 'note',
    }
    updateTransaction(db, fields)
    expect(links()).toHaveLength(1)
    updateTransaction(db, { ...fields, amountCents: -5001 })
    expect(links()).toEqual([])

    updateTransaction(db, { ...fields, amountCents: -5000 })
    pairTransfers(db)
    updateTransaction(db, { ...fields, accountId: travel })
    expect(links()).toEqual([])

    updateTransaction(db, { ...fields, accountId: everyday })
    pairTransfers(db)
    deleteTransaction(db, into)
    expect(links()).toEqual([])
  })
})

describe('imports and transfers', () => {
  it('pairs after an import, counts the pairs, and unpairs when undone', () => {
    add(everyday, '2026-05-27', -125000, 'Fake To Savings')
    const session = new ImportSession()
    const opened = session.open(
      db,
      'savings.csv',
      new TextEncoder().encode(
        '27/05/2026,+1250.00,Fake From Everyday,1\n28/05/2026,-3.00,Fake Fee,1\n',
      ),
    )
    if (!opened.ok) throw new Error(opened.reason)
    const committed = previewAndCommit(db, session, {
      id: opened.file.id,
      encoding: opened.file.encoding,
      mapping: opened.file.mapping!,
      targets: [{ key: '', accountId: savings }],
      selected: [0, 1],
    })
    expect(committed).toMatchObject({ ok: true, count: 2, paired: 1 })
    expect(listBatches(db)).toMatchObject([{ count: 2, edited: 0, paired: 1 }])
    expect(undoBatch(db, 1)).toEqual({ ok: true, count: 2, kept: 0 })
    expect(links()).toEqual([])
  })
})

describe('pairing after an import', () => {
  it('pairs only around the imported rows', () => {
    // Older rows that could pair are left to the user.
    add(everyday, '2026-04-01', -2500, 'Fake Old Purchase')
    add(savings, '2026-04-02', 2500, 'Fake Old Refund')
    add(everyday, '2026-05-27', -125000, 'Fake To Savings')
    const category = createCategory(db, { name: 'Fake Moves', parentId: null })
    if (!category.ok) throw new Error('no category')
    createRule(db, {
      pattern: 'fake from',
      match: 'contains',
      categoryId: category.id,
      apply: false,
    })
    const session = new ImportSession()
    const opened = session.open(
      db,
      'savings.csv',
      new TextEncoder().encode('27/05/2026,+1250.00,Fake From Everyday,1\n'),
    )
    if (!opened.ok) throw new Error(opened.reason)
    const result = previewAndCommit(db, session, {
      id: opened.file.id,
      encoding: opened.file.encoding,
      mapping: opened.file.mapping!,
      targets: [{ key: '', accountId: savings }],
      selected: [0],
    })
    expect(result).toMatchObject({ ok: true, paired: 1 })
    expect(
      db
        .prepare(
          "SELECT category_id FROM transactions WHERE description = 'Fake From Everyday'",
        )
        .pluck()
        .get(),
    ).toBeNull()
    expect(possibleTransfers(db).map((pair) => pair.out.description)).toEqual([
      'Fake Old Purchase',
    ])
  })
})

describe('moving an imported transaction', () => {
  it('drops its fingerprint, so the same row can sit in both accounts', () => {
    const session = new ImportSession()
    const text = new TextEncoder().encode('01/05/2026,-1.00,Fake Same,1\n')
    for (const accountId of [everyday, savings]) {
      const opened = session.open(db, 'same.csv', Uint8Array.from(text))
      if (!opened.ok) throw new Error(opened.reason)
      previewAndCommit(db, session, {
        id: opened.file.id,
        encoding: opened.file.encoding,
        mapping: opened.file.mapping!,
        targets: [{ key: '', accountId }],
        selected: [0],
      })
    }
    const [first] = pageTransactions(db, {
      filter: { accountId: everyday },
      limit: 1,
    }).rows
    expect(
      updateTransaction(db, { ...first!, accountId: savings, notes: '' }),
    ).toEqual({ ok: true })
    expect(
      db
        .prepare('SELECT hash IS NULL FROM transactions WHERE id = ?')
        .pluck()
        .get(first!.id),
    ).toBe(1)
  })
})

describe('the seeded ledger', () => {
  it('pairs every savings transfer and card repayment', () => {
    insertLedger(db, generateLedger({ end: new Date(2026, 10, 8) }))
    const pairs = db
      .prepare(
        `SELECT o.description AS out, i.description AS "in"
         FROM transfer_links l
         JOIN transactions o ON o.id = l.out_id
         JOIN transactions i ON i.id = l.in_id
         WHERE l.status = 'confirmed'`,
      )
      .all() as { out: string; in: string }[]
    const expected = db
      .prepare(
        `SELECT count(*) FROM transactions
         WHERE description IN ('Transfer to Savings', 'Card Repayment 4417')`,
      )
      .pluck()
      .get()
    expect(pairs).toHaveLength(expected as number)
    expect(new Set(pairs.map((pair) => `${pair.out} → ${pair.in}`))).toEqual(
      new Set([
        'Transfer to Savings → Transfer from Everyday',
        'Card Repayment 4417 → Payment Received, Thank You',
      ]),
    )
  })
})
