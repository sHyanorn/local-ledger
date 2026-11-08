import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAccount } from '../../src/main/ledger/accounts'
import { createCategory } from '../../src/main/ledger/categories'
import {
  categoryTrend,
  reportData,
  shiftMonth,
} from '../../src/main/ledger/reports'
import { createTransaction } from '../../src/main/ledger/transactions'
import { pairTransfers } from '../../src/main/ledger/transfers'
import { openDatabase, type Db } from '../../src/main/vault/database'
import { schemas } from '../../src/shared/schemas'

let dir: string
let db: Db
const ids: Record<string, number> = {}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-reports-'))
  db = openDatabase(join(dir, 'ledger.db'), Buffer.alloc(32, 7), {
    create: true,
  })
  for (const [name, currency] of [
    ['everyday', 'AUD'],
    ['savings', 'AUD'],
    ['travel', 'CNY'],
  ] as const) {
    const result = createAccount(db, {
      name,
      type: 'bank',
      currency,
      openingBalanceCents: 0,
    })
    if (!result.ok) throw new Error('no account')
    ids[name] = result.id
  }
  for (const [name, parent] of [
    ['food', null],
    ['coffee', 'food'],
    ['income', null],
  ] as const) {
    const result = createCategory(db, {
      name: `Fake ${name}`,
      parentId: parent ? ids[parent]! : null,
    })
    if (!result.ok) throw new Error('no category')
    ids[name] = result.id
  }
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const add = (
  account: string,
  date: string,
  amountCents: number,
  category: string | null,
) => {
  const result = createTransaction(db, {
    accountId: ids[account]!,
    date,
    amountCents,
    description: 'Fake',
    categoryId: category ? ids[category]! : null,
    notes: '',
  })
  if (!result.ok) throw new Error('no transaction')
}

describe('shiftMonth', () => {
  it.each([
    ['2026-11', 1, '2026-12'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-11', -11, '2025-12'],
  ])('%s %+d is %s', (month, offset, result) => {
    expect(shiftMonth(month, offset)).toBe(result)
  })
})

describe('reports', () => {
  it('net each top-level category, so a refund lowers spending, and keep currencies and transfers out', () => {
    add('everyday', '2026-11-02', 500000, 'income')
    add('everyday', '2026-11-03', -3000, 'food')
    add('everyday', '2026-11-04', -450, 'coffee')
    add('everyday', '2026-11-05', 1000, 'food')
    add('everyday', '2026-11-06', -700, null)
    add('travel', '2026-11-06', -99999, 'food')
    add('everyday', '2026-11-07', -100000, null)
    add('savings', '2026-11-07', 100000, null)
    expect(pairTransfers(db)).toBe(1)

    const { report, months } = reportData(db, '2026-11', 'AUD')
    expect(report).toMatchObject({
      incomeCents: 500000,
      spendingCents: 2450 + 700,
    })
    expect(report.categories).toEqual([
      { categoryId: ids.food, netCents: -2450 },
      { categoryId: null, netCents: -700 },
      { categoryId: ids.income, netCents: 500000 },
    ])
    expect(months).toHaveLength(12)
    expect(months[0]?.month).toBe('2025-12')
    expect(months.at(-1)).toEqual({
      month: '2026-11',
      incomeCents: 500000,
      spendingCents: 3150,
    })
    expect(reportData(db, '2026-11', 'CNY').report.spendingCents).toBe(99999)
  })

  it('trace a category with its subcategories over twelve months', () => {
    add('everyday', '2026-10-03', -3000, 'food')
    add('everyday', '2026-11-04', -450, 'coffee')
    add('everyday', '2026-11-05', 5000, 'food')
    add('everyday', '2025-11-30', -9999, 'food')
    const trend = categoryTrend(db, ids.food!, '2026-11', 'AUD')
    expect(trend).toHaveLength(12)
    expect(trend.slice(-2)).toEqual([
      { month: '2026-10', spentCents: 3000 },
      { month: '2026-11', spentCents: 0 },
    ])
    expect(trend[0]).toEqual({ month: '2025-12', spentCents: 0 })
  })
})

describe('report payloads', () => {
  it('refuse an unknown currency, a bad month or a bad category', () => {
    expect(
      schemas.report.safeParse({ month: '2026-05', currency: 'XYZ' }).success,
    ).toBe(false)
    expect(
      schemas.report.safeParse({ month: '2026-13', currency: 'AUD' }).success,
    ).toBe(false)
    expect(
      schemas.trend.safeParse({
        categoryId: 0,
        month: '2026-05',
        currency: 'AUD',
      }).success,
    ).toBe(false)
    expect(
      schemas.trend.safeParse({
        categoryId: 1,
        month: '2026-05',
        currency: 'AUD',
      }).success,
    ).toBe(true)
  })
})
