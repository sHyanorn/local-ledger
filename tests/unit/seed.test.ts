import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateLedger } from '../../scripts/seed/generate'
import { insertLedger } from '../../scripts/seed/insert'
import { appUserDataDirs, isAppUserData } from '../../scripts/seed/user-data'
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

  it('scales to about the number of transactions asked for', () => {
    for (const asked of [1500, 20000]) {
      const { length } = generateLedger({
        end: END,
        transactions: asked,
      }).transactions
      expect(Math.abs(length - asked)).toBeLessThanOrEqual(36)
    }
  })

  it('keeps balances plausible: cash never negative, the card paid down, savings growing', () => {
    const ledger = generateLedger({ end: END })
    const balance = (name: string) => {
      const account = ledger.accounts.find((a) => a.name === name)
      if (!account) throw new Error(name)
      return ledger.transactions
        .filter((row) => row.account === name)
        .reduce(
          (sum, row) => sum + row.amountCents,
          account.openingBalanceCents,
        )
    }
    expect(balance('Everyday')).toBeGreaterThan(0)
    expect(balance('Travel Cash')).toBeGreaterThanOrEqual(0)
    expect(balance('Credit Card')).toBeGreaterThan(-500000)
    expect(balance('Savings')).toBeGreaterThan(1200000)
    // Every transfer appears in both accounts.
    const out = ledger.transactions.filter(
      (r) => r.description === 'Card Repayment 4417',
    )
    const into = ledger.transactions.filter(
      (r) => r.description === 'Payment Received, Thank You',
    )
    expect(out.map((r) => [r.date, -r.amountCents])).toEqual(
      into.map((r) => [r.date, r.amountCents]),
    )
    expect(out.length).toBeGreaterThan(10)
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

describe('the seed', () => {
  it('knows where the app keeps its data on each platform', () => {
    const home = '/home/fake'
    expect(appUserDataDirs('linux', {}, home)).toEqual([
      '/home/fake/.config/local-ledger',
      '/home/fake/.config/local-ledger-dev',
    ])
    expect(
      appUserDataDirs('linux', { XDG_CONFIG_HOME: '/fake/config' }, home)[0],
    ).toBe('/fake/config/local-ledger')
    expect(appUserDataDirs('darwin', {}, home)[0]).toBe(
      '/home/fake/Library/Application Support/local-ledger',
    )
  })

  it('refuses the app’s own data directories and anything inside them', () => {
    const dirs = [
      '/home/fake/.config/local-ledger',
      '/home/fake/.config/local-ledger-dev',
    ]
    expect(
      isAppUserData('/home/fake/.config/local-ledger', dirs, 'linux'),
    ).toBe(true)
    expect(
      isAppUserData('/home/fake/.config/local-ledger-dev/vault', dirs, 'linux'),
    ).toBe(true)
    expect(
      isAppUserData('/home/fake/.config/LOCAL-LEDGER', dirs, 'darwin'),
    ).toBe(true)
    expect(
      isAppUserData('/home/fake/.config/LOCAL-LEDGER', dirs, 'linux'),
    ).toBe(false)
    expect(isAppUserData('/home/fake/.config', dirs, 'linux')).toBe(false)
    expect(
      isAppUserData('/home/fake/.config/local-ledger-demo', dirs, 'linux'),
    ).toBe(false)
    expect(
      isAppUserData(
        '/home/fake/projects/local-ledger/.demo/user-data',
        dirs,
        'linux',
      ),
    ).toBe(false)
  })
})
