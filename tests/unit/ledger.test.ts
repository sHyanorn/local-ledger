import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
} from '../../src/main/ledger/accounts'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../../src/main/ledger/categories'
import {
  createTransaction,
  deleteTransaction,
  pageTransactions,
  setTransactionCategory,
  totalTransactions,
  updateTransaction,
} from '../../src/main/ledger/transactions'
import { openDatabase } from '../../src/main/vault/database'
import type { Db } from '../../src/main/vault/database'
import type {
  AccountFields,
  TransactionFields,
  TransactionFilter,
} from '../../src/shared/ledger'

let dir: string
let db: Db
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-data-'))
  db = openDatabase(join(dir, 'ledger.db'), Buffer.alloc(32, 7), {
    create: true,
  })
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const created = (result: { ok: boolean; id?: number }) => {
  if (!result.ok || result.id === undefined) throw new Error('not created')
  return result.id
}
const account = (fields: Partial<AccountFields> = {}) =>
  created(
    createAccount(db, {
      name: 'Fake Everyday',
      type: 'bank',
      currency: 'AUD',
      openingBalanceCents: 0,
      ...fields,
    }),
  )
const category = (name: string, parentId: number | null = null) =>
  created(createCategory(db, { name, parentId }))
const transaction = (
  fields: Partial<TransactionFields> & { accountId: number },
) =>
  created(
    createTransaction(db, {
      date: '2026-01-15',
      amountCents: -1000,
      description: 'Fake purchase',
      categoryId: null,
      notes: '',
      ...fields,
    }),
  )

describe('accounts', () => {
  it('lists each with its balance: the opening balance plus its transactions', () => {
    const everyday = account({ openingBalanceCents: 50000 })
    const cash = account({ name: 'Fake Cash', type: 'cash' })
    transaction({ accountId: everyday, amountCents: -1250 })
    transaction({ accountId: everyday, amountCents: 300000 })
    expect(listAccounts(db)).toEqual([
      expect.objectContaining({
        id: cash,
        name: 'Fake Cash',
        balanceCents: 0,
        transactionCount: 0,
      }),
      expect.objectContaining({
        id: everyday,
        openingBalanceCents: 50000,
        balanceCents: 348750,
        transactionCount: 2,
      }),
    ])
  })

  it('keeps names unique, ignoring case', () => {
    account()
    expect(
      createAccount(db, {
        name: 'FAKE EVERYDAY',
        type: 'bank',
        currency: 'AUD',
        openingBalanceCents: 0,
      }),
    ).toEqual({ ok: false, reason: 'duplicate' })
    const other = account({ name: 'Fake Savings' })
    expect(
      updateAccount(db, {
        id: other,
        name: 'fake everyday',
        type: 'savings',
        currency: 'AUD',
        openingBalanceCents: 0,
      }),
    ).toEqual({ ok: false, reason: 'duplicate' })
  })

  it('changes the currency only while the account has no transactions', () => {
    const id = account()
    const fields = {
      id,
      name: 'Fake Everyday',
      type: 'bank' as const,
      openingBalanceCents: 0,
    }
    expect(updateAccount(db, { ...fields, currency: 'NZD' })).toEqual({
      ok: true,
    })
    transaction({ accountId: id })
    expect(updateAccount(db, { ...fields, currency: 'AUD' })).toEqual({
      ok: false,
      reason: 'currency-in-use',
    })
    expect(
      updateAccount(db, { ...fields, name: 'Fake Renamed', currency: 'NZD' }),
    ).toEqual({ ok: true })
    expect(updateAccount(db, { ...fields, id: 99, currency: 'NZD' })).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it('deletes only an account without transactions', () => {
    const used = account()
    const empty = account({ name: 'Fake Empty' })
    transaction({ accountId: used })
    expect(deleteAccount(db, used)).toEqual({ ok: false, reason: 'in-use' })
    expect(deleteAccount(db, empty)).toEqual({ ok: true })
    expect(deleteAccount(db, empty)).toEqual({ ok: false, reason: 'not-found' })
    expect(listAccounts(db).map((a) => a.id)).toEqual([used])
  })
})

describe('categories', () => {
  it('nest two levels at most', () => {
    const food = category('Fake Food')
    const groceries = category('Fake Groceries', food)
    expect(
      createCategory(db, { name: 'Fake Fruit', parentId: groceries }),
    ).toEqual({ ok: false, reason: 'too-deep' })
    expect(createCategory(db, { name: 'Fake Fruit', parentId: 99 })).toEqual({
      ok: false,
      reason: 'not-found',
    })
    // A category with subcategories cannot become one.
    const home = category('Fake Home')
    expect(
      updateCategory(db, { id: food, name: 'Fake Food', parentId: home }),
    ).toEqual({ ok: false, reason: 'too-deep' })
    expect(
      updateCategory(db, { id: home, name: 'Fake Home', parentId: home }),
    ).toEqual({ ok: false, reason: 'too-deep' })
    expect(
      updateCategory(db, {
        id: groceries,
        name: 'Fake Groceries',
        parentId: home,
      }),
    ).toEqual({ ok: true })
    expect(
      updateCategory(db, { id: 99, name: 'Fake', parentId: null }),
    ).toEqual({ ok: false, reason: 'not-found' })
  })

  it('keep names unique under the same parent, ignoring case', () => {
    const food = category('Fake Food')
    const home = category('Fake Home')
    category('Fake Other', food)
    expect(createCategory(db, { name: 'fake other', parentId: food })).toEqual({
      ok: false,
      reason: 'duplicate',
    })
    expect(createCategory(db, { name: 'FAKE FOOD', parentId: null })).toEqual({
      ok: false,
      reason: 'duplicate',
    })
    // The same name elsewhere in the tree is fine.
    category('Fake Other', home)
    category('Fake Other')
  })

  it('count their transactions', () => {
    const accountId = account()
    const food = category('Fake Food')
    transaction({ accountId, categoryId: food })
    transaction({ accountId, categoryId: food })
    expect(listCategories(db)).toEqual([
      { id: food, name: 'Fake Food', parentId: null, transactionCount: 2 },
    ])
  })

  it('go with their subcategories and budgets; their transactions become uncategorized', () => {
    const accountId = account()
    const food = category('Fake Food')
    const groceries = category('Fake Groceries', food)
    const home = category('Fake Home')
    transaction({ accountId, categoryId: food })
    transaction({ accountId, categoryId: groceries })
    transaction({ accountId, categoryId: home })
    db.prepare(
      "INSERT INTO budgets (category_id, month, amount_cents) VALUES (?, '2026-01', 50000)",
    ).run(groceries)

    expect(deleteCategory(db, food)).toEqual({ ok: true })
    expect(listCategories(db).map((c) => c.id)).toEqual([home])
    expect(
      db
        .prepare('SELECT count(*) FROM transactions WHERE category_id IS NULL')
        .pluck()
        .get(),
    ).toBe(2)
    expect(db.prepare('SELECT count(*) FROM budgets').pluck().get()).toBe(0)
    expect(deleteCategory(db, food)).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('transactions', () => {
  let everyday: number
  let travel: number
  beforeEach(() => {
    everyday = account()
    travel = account({ name: 'Fake Travel', type: 'cash', currency: 'CNY' })
  })

  const page = (filter: TransactionFilter = {}, limit = 100) =>
    pageTransactions(db, { filter, limit }).rows.map((row) => row.description)

  it('come newest first, and pages follow each other without gaps or repeats', () => {
    // Several on one day, so the order within a day matters.
    for (let day = 1; day <= 5; day++) {
      for (let n = 1; n <= 3; n++) {
        transaction({
          accountId: everyday,
          date: `2026-01-0${day}`,
          description: `Fake ${day}.${n}`,
        })
      }
    }
    const seen: string[] = []
    let after: { date: string; id: number } | undefined
    for (;;) {
      const result = pageTransactions(db, { filter: {}, limit: 4, after })
      seen.push(...result.rows.map((row) => row.description))
      if (!result.next) break
      after = result.next
    }
    expect(seen).toEqual(page())
    expect(seen).toHaveLength(15)
    expect(seen.slice(0, 4)).toEqual([
      'Fake 5.3',
      'Fake 5.2',
      'Fake 5.1',
      'Fake 4.3',
    ])
    expect(new Set(seen).size).toBe(15)
  })

  it('come with their account currency, and empty notes as an empty string', () => {
    const id = transaction({ accountId: travel, notes: '' })
    expect(pageTransactions(db, { filter: {}, limit: 1 }).rows[0]).toEqual({
      id,
      accountId: travel,
      date: '2026-01-15',
      amountCents: -1000,
      description: 'Fake purchase',
      categoryId: null,
      notes: '',
      currency: 'CNY',
    })
    expect(
      db.prepare('SELECT notes FROM transactions').pluck().get(),
    ).toBeNull()
  })

  it('filter by account, category with its subcategories, date and text', () => {
    const food = category('Fake Food')
    const groceries = category('Fake Groceries', food)
    transaction({
      accountId: everyday,
      description: 'Fake Bakery',
      categoryId: food,
      date: '2026-01-02',
    })
    transaction({
      accountId: everyday,
      description: 'Fake Greengrocer',
      categoryId: groceries,
      date: '2026-02-03',
    })
    transaction({
      accountId: travel,
      description: 'Fake Taxi',
      date: '2026-03-04',
      notes: 'airport run',
    })
    transaction({
      accountId: travel,
      description: '100% Fake_Store',
      date: '2026-03-05',
    })

    expect(page({ accountId: travel })).toEqual([
      '100% Fake_Store',
      'Fake Taxi',
    ])
    expect(page({ category: food })).toEqual([
      'Fake Greengrocer',
      'Fake Bakery',
    ])
    expect(page({ category: groceries })).toEqual(['Fake Greengrocer'])
    expect(page({ category: 'none' })).toEqual(['100% Fake_Store', 'Fake Taxi'])
    expect(page({ from: '2026-02-01', to: '2026-03-04' })).toEqual([
      'Fake Taxi',
      'Fake Greengrocer',
    ])
    // Description and notes, ignoring ASCII case.
    expect(page({ text: 'GROCER' })).toEqual(['Fake Greengrocer'])
    expect(page({ text: 'Airport' })).toEqual(['Fake Taxi'])
    // Wildcard characters are matched literally.
    expect(page({ text: '%' })).toEqual(['100% Fake_Store'])
    expect(page({ text: 'e_S' })).toEqual(['100% Fake_Store'])
    expect(page({ text: '   ' })).toHaveLength(4)
    expect(page({ accountId: everyday, text: 'taxi' })).toEqual([])
  })

  it('match search text literally: wildcards and the escape character are plain', () => {
    transaction({ accountId: everyday, description: 'Fake abc' })
    transaction({ accountId: everyday, description: 'Fake a_c' })
    transaction({ accountId: everyday, description: 'Fake a\\c' })
    transaction({
      accountId: everyday,
      description: 'Fake plain',
      notes: '50% off',
    })
    expect(page({ text: 'a_c' })).toEqual(['Fake a_c'])
    expect(page({ text: 'a\\c' })).toEqual(['Fake a\\c'])
    expect(page({ text: '\\' })).toEqual(['Fake a\\c'])
    // The notes have their own ESCAPE clause.
    expect(page({ text: '0%' })).toEqual(['Fake plain'])
  })

  it('page by date, then by newest entry, whatever order they were entered in', () => {
    const add = (date: string, description: string) =>
      transaction({ accountId: everyday, date, description })
    add('2026-03-01', 'Fake D')
    add('2026-04-01', 'Fake E')
    add('2026-01-01', 'Fake A') // entered after later dates
    add('2026-02-01', 'Fake B')
    add('2026-02-01', 'Fake C') // same day, entered later
    const first = pageTransactions(db, { filter: {}, limit: 2 })
    const second = pageTransactions(db, {
      filter: {},
      limit: 2,
      after: first.next ?? undefined,
    })
    const third = pageTransactions(db, {
      filter: {},
      limit: 2,
      after: second.next ?? undefined,
    })
    expect(
      [first, second, third].flatMap((p) => p.rows.map((r) => r.description)),
    ).toEqual(['Fake E', 'Fake D', 'Fake C', 'Fake B', 'Fake A'])
    expect(second.next).not.toBeNull()
    expect(third.next).toBeNull()
    // A last page that is exactly full has no next page either.
    expect(pageTransactions(db, { filter: {}, limit: 5 }).next).toBeNull()
  })

  it('include both ends of a date range', () => {
    transaction({
      accountId: everyday,
      date: '2026-01-31',
      description: 'Fake before',
    })
    transaction({
      accountId: everyday,
      date: '2026-02-01',
      description: 'Fake first',
    })
    transaction({
      accountId: everyday,
      date: '2026-02-28',
      description: 'Fake last',
    })
    transaction({
      accountId: everyday,
      date: '2026-03-01',
      description: 'Fake after',
    })
    expect(page({ from: '2026-02-01', to: '2026-02-28' })).toEqual([
      'Fake last',
      'Fake first',
    ])
  })

  it('change their category alone', () => {
    const food = category('Fake Food')
    const id = transaction({
      accountId: everyday,
      description: 'Fake kept',
      notes: 'fake note',
    })
    expect(setTransactionCategory(db, id, food)).toEqual({ ok: true })
    expect(
      pageTransactions(db, { filter: {}, limit: 1 }).rows[0],
    ).toMatchObject({
      description: 'Fake kept',
      notes: 'fake note',
      categoryId: food,
    })
    expect(setTransactionCategory(db, id, null)).toEqual({ ok: true })
    expect(setTransactionCategory(db, id, 99)).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(setTransactionCategory(db, 99, null)).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it('total by currency, never across currencies', () => {
    transaction({ accountId: everyday, amountCents: -1000 })
    transaction({ accountId: everyday, amountCents: 250000 })
    transaction({ accountId: travel, amountCents: -8800 })
    expect(totalTransactions(db, {})).toEqual([
      { currency: 'AUD', count: 2, cents: 249000 },
      { currency: 'CNY', count: 1, cents: -8800 },
    ])
    expect(totalTransactions(db, { accountId: travel })).toEqual([
      { currency: 'CNY', count: 1, cents: -8800 },
    ])
    expect(totalTransactions(db, { text: 'nothing like this' })).toEqual([])
  })

  it('refer only to accounts and categories that exist', () => {
    const fields = {
      accountId: everyday,
      date: '2026-01-15',
      amountCents: 1,
      description: 'Fake',
      categoryId: null,
      notes: '',
    }
    expect(createTransaction(db, { ...fields, accountId: 99 })).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(createTransaction(db, { ...fields, categoryId: 99 })).toEqual({
      ok: false,
      reason: 'not-found',
    })
    const id = transaction({ accountId: everyday })
    expect(updateTransaction(db, { ...fields, id, categoryId: 99 })).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it('update and delete', () => {
    const food = category('Fake Food')
    const id = transaction({ accountId: everyday })
    expect(
      updateTransaction(db, {
        id,
        accountId: travel,
        date: '2026-02-01',
        amountCents: 4200,
        description: 'Fake refund',
        categoryId: food,
        notes: 'fake note',
      }),
    ).toEqual({ ok: true })
    expect(
      pageTransactions(db, { filter: {}, limit: 1 }).rows[0],
    ).toMatchObject({
      accountId: travel,
      amountCents: 4200,
      categoryId: food,
      notes: 'fake note',
      currency: 'CNY',
    })
    expect(deleteTransaction(db, id)).toEqual({ ok: true })
    expect(deleteTransaction(db, id)).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(
      updateTransaction(db, {
        id,
        accountId: travel,
        date: '2026-02-01',
        amountCents: 1,
        description: 'Fake',
        categoryId: null,
        notes: '',
      }),
    ).toEqual({ ok: false, reason: 'not-found' })
  })
})
