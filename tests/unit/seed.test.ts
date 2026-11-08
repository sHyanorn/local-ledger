import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateLedger } from '../../scripts/seed/generate'
import { insertLedger } from '../../scripts/seed/insert'
import { listAccounts } from '../../src/main/ledger/accounts'
import { listCategories } from '../../src/main/ledger/categories'
import { totalTransactions } from '../../src/main/ledger/transactions'
import { openDatabase } from '../../src/main/vault/database'
import { isIsoDate } from '../../src/shared/dates'

const END = new Date(2026, 10, 8)

describe('generateLedger', () => {
  it('gives the same ledger for the same seed and end date', () => {
    expect(generateLedger({ end: END })).toEqual(generateLedger({ end: END }))
    expect(generateLedger({ end: END, seed: 2 })).not.toEqual(
      generateLedger({ end: END }),
    )
  })

  it('spans the months asked for, in date order, up to the end date', () => {
    const { transactions } = generateLedger({ end: END, months: 18 })
    const dates = transactions.map((row) => row.date)
    expect(dates.every(isIsoDate)).toBe(true)
    expect(dates).toEqual([...dates].sort())
    expect(dates[0]?.slice(0, 7)).toBe('2025-06')
    expect(dates.at(-1)! <= '2026-11-08').toBe(true)
    expect(dates.at(-1)!.slice(0, 7)).toBe('2026-11')
  })

  it('refers only to its own accounts and categories, and mixes in what the page must handle', () => {
    const ledger = generateLedger({ end: END })
    const accounts = new Set(ledger.accounts.map((a) => a.name))
    const categories = new Set(
      ledger.categories.flatMap((c) => [
        c.name,
        ...c.children.map((child) => `${c.name}/${child}`),
      ]),
    )
    for (const row of ledger.transactions) {
      expect(accounts.has(row.account)).toBe(true)
      if (row.category !== null) expect(categories.has(row.category)).toBe(true)
    }
    const rows = ledger.transactions
    expect(rows.some((row) => row.category === null)).toBe(true)
    expect(rows.some((row) => row.notes !== '')).toBe(true)
    expect(rows.some((row) => row.amountCents > 0)).toBe(true)
    expect(new Set(ledger.accounts.map((a) => a.currency))).toEqual(
      new Set(['AUD', 'CNY']),
    )
  })

  it('scales to the number of transactions asked for', () => {
    expect(
      generateLedger({ end: END, transactions: 3000 }).transactions,
    ).toHaveLength(3000)
    expect(
      generateLedger({ end: END, transactions: 20000 }).transactions,
    ).toHaveLength(20000)
  })
})

describe('insertLedger', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('fills an empty database, with balances per account and totals per currency', () => {
    dir = mkdtempSync(join(tmpdir(), 'ledger-seed-'))
    const db = openDatabase(join(dir, 'ledger.db'), Buffer.alloc(32, 3), {
      create: true,
    })
    try {
      const ledger = generateLedger({ end: END })
      insertLedger(db, ledger)
      const accounts = listAccounts(db)
      expect(accounts.map((a) => a.name)).toEqual([
        'Credit Card',
        'Everyday',
        'Savings',
        'Travel Cash',
      ])
      expect(accounts.reduce((sum, a) => sum + a.transactionCount, 0)).toBe(
        ledger.transactions.length,
      )
      expect(listCategories(db)).toHaveLength(
        ledger.categories.reduce((sum, c) => sum + 1 + c.children.length, 0),
      )
      expect(totalTransactions(db, {}).map((t) => t.currency)).toEqual([
        'AUD',
        'CNY',
      ])
    } finally {
      db.close()
    }
  })
})
