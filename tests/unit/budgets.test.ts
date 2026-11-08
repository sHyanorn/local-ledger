import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAccount } from '../../src/main/ledger/accounts'
import { monthBudgets, setBudget } from '../../src/main/ledger/budgets'
import {
  createCategory,
  deleteCategory,
} from '../../src/main/ledger/categories'
import { createTransaction } from '../../src/main/ledger/transactions'
import { pairTransfers } from '../../src/main/ledger/transfers'
import { openDatabase, type Db } from '../../src/main/vault/database'
import { budgetState, type MonthBudgets } from '../../src/shared/budgets'
import { schemas } from '../../src/shared/schemas'

let dir: string
let db: Db
let everyday: number
let savings: number
let travel: number
let food: number
let coffee: number
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-budgets-'))
  db = openDatabase(join(dir, 'ledger.db'), Buffer.alloc(32, 7), {
    create: true,
  })
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
  const category = (name: string, parentId: number | null = null) => {
    const result = createCategory(db, { name, parentId })
    if (!result.ok) throw new Error('no category')
    return result.id
  }
  food = category('Fake Food')
  coffee = category('Fake Coffee', food)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const add = (
  accountId: number,
  date: string,
  amountCents: number,
  categoryId: number | null,
) => {
  const result = createTransaction(db, {
    accountId,
    date,
    amountCents,
    description: 'Fake',
    categoryId,
    notes: '',
  })
  if (!result.ok) throw new Error('no transaction')
}
const of = (budgets: MonthBudgets, id: number) =>
  budgets.categories.find((entry) => entry.categoryId === id)

describe('budgets', () => {
  it('hold from their month until changed or ended', () => {
    setBudget(db, { categoryId: food, month: '2026-03', amountCents: 60000 })
    setBudget(db, { categoryId: food, month: '2026-06', amountCents: 70000 })
    setBudget(db, { categoryId: food, month: '2026-09', amountCents: null })
    expect(of(monthBudgets(db, '2026-02'), food)?.budgetCents).toBeNull()
    expect(of(monthBudgets(db, '2026-05'), food)?.budgetCents).toBe(60000)
    expect(of(monthBudgets(db, '2026-06'), food)?.budgetCents).toBe(70000)
    expect(of(monthBudgets(db, '2026-12'), food)?.budgetCents).toBeNull()
    // Setting the same month again replaces it.
    setBudget(db, { categoryId: food, month: '2026-06', amountCents: 0 })
    expect(of(monthBudgets(db, '2026-07'), food)?.budgetCents).toBe(0)
  })

  it('refuse a missing category, and go with a deleted one', () => {
    expect(
      setBudget(db, { categoryId: 999, month: '2026-03', amountCents: 1 }),
    ).toEqual({ ok: false, reason: 'not-found' })
    setBudget(db, { categoryId: coffee, month: '2026-03', amountCents: 1 })
    deleteCategory(db, food)
    expect(db.prepare('SELECT count(*) FROM budgets').pluck().get()).toBe(0)
  })
})

describe('spending', () => {
  it('nets refunds within the month, includes subcategories, and never goes below zero', () => {
    add(everyday, '2026-05-01', -3000, food)
    add(everyday, '2026-05-31', -450, coffee)
    add(everyday, '2026-05-20', 1000, food)
    add(everyday, '2026-04-30', -9999, food)
    add(everyday, '2026-06-01', -9999, food)
    add(everyday, '2026-05-10', 800, coffee)
    const may = monthBudgets(db, '2026-05')
    expect(of(may, food)?.spentCents).toBe(3000 + 450 - 1000 - 800)
    expect(of(may, coffee)?.spentCents).toBe(0)
  })

  it('counts only the home currency, lists others, and leaves transfers out', () => {
    add(everyday, '2026-05-02', -2500, food)
    add(travel, '2026-05-02', -8800, food)
    add(travel, '2026-05-03', 100, null)
    // A refund nets in its category, as in Reports.
    add(travel, '2026-05-06', -3000, coffee)
    add(travel, '2026-05-07', 1000, coffee)
    add(everyday, '2026-05-04', -700, null)
    // A transfer whose sides are categorized does not count.
    add(everyday, '2026-05-05', -50000, food)
    add(savings, '2026-05-05', 50000, null)
    expect(pairTransfers(db)).toBe(1)
    const may = monthBudgets(db, '2026-05')
    expect(of(may, food)?.spentCents).toBe(2500)
    expect(may.uncategorizedCents).toBe(700)
    expect(may.otherCurrencies).toEqual([
      { currency: 'CNY', spentCents: 8800 + 2000 },
    ])
  })

  it('crosses from under to close at 90% and over past 100%', () => {
    expect(
      budgetState({ categoryId: 1, budgetCents: null, spentCents: 5 }),
    ).toBe('none')
    expect(budgetState({ categoryId: 1, budgetCents: 0, spentCents: 0 })).toBe(
      'under',
    )
    expect(
      budgetState({ categoryId: 1, budgetCents: 1000, spentCents: 899 }),
    ).toBe('under')
    expect(
      budgetState({ categoryId: 1, budgetCents: 1000, spentCents: 900 }),
    ).toBe('close')
    expect(
      budgetState({ categoryId: 1, budgetCents: 1000, spentCents: 1000 }),
    ).toBe('close')
    expect(
      budgetState({ categoryId: 1, budgetCents: 1000, spentCents: 1001 }),
    ).toBe('over')
    expect(budgetState({ categoryId: 1, budgetCents: 0, spentCents: 1 })).toBe(
      'over',
    )
  })
})

describe('budget payloads', () => {
  it.each(['2026-13', '2026-1', '1899-12', '2026-05-01', ''])(
    'refuse the month %j',
    (month) => {
      expect(schemas.budgetMonth.safeParse({ month }).success).toBe(false)
    },
  )
  it('refuse a negative or fractional amount', () => {
    for (const amountCents of [-1, 1.5, 1e14]) {
      expect(
        schemas.budgetSet.safeParse({
          categoryId: 1,
          month: '2026-05',
          amountCents,
        }).success,
      ).toBe(false)
    }
    expect(
      schemas.budgetSet.safeParse({
        categoryId: 1,
        month: '2026-05',
        amountCents: null,
      }).success,
    ).toBe(true)
  })
})
