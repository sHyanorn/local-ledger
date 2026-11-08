import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAccount } from '../../src/main/ledger/accounts'
import { monthBudgets, setBudget } from '../../src/main/ledger/budgets'
import { createCategory } from '../../src/main/ledger/categories'
import { getSettings, updateSettings } from '../../src/main/ledger/settings'
import { createTransaction } from '../../src/main/ledger/transactions'
import type { Db } from '../../src/main/vault/database'
import { schemas } from '../../src/shared/schemas'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { tempDatabase, type TempDatabase } from '../support/temp-database'

let temp: TempDatabase
let db: Db
beforeEach(() => {
  temp = tempDatabase('ledger-settings-')
  db = temp.db
})
afterEach(() => temp.dispose())

describe('settings', () => {
  it('read as defaults until set, and keep what is not changed', () => {
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS)
    expect(updateSettings(db, { idleLockMinutes: 15 })).toEqual({
      homeCurrency: 'AUD',
      idleLockMinutes: 15,
    })
    expect(updateSettings(db, { homeCurrency: 'CNY' })).toEqual({
      homeCurrency: 'CNY',
      idleLockMinutes: 15,
    })
  })

  it('read a value they do not know as the default', () => {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('home_currency', 'XYZ'), ('idle_lock_minutes', '0')",
    ).run()
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS)
  })

  it('accept only known currencies and lock times, and something to change', () => {
    for (const changes of [
      {},
      { homeCurrency: 'XYZ' },
      { idleLockMinutes: 0 },
      { idleLockMinutes: 2 },
      { idleLockMinutes: '5' },
      { theme: 'dark' },
    ]) {
      expect(schemas.settingsUpdate.safeParse(changes).success).toBe(false)
    }
    expect(
      schemas.settingsUpdate.safeParse({
        homeCurrency: 'EUR',
        idleLockMinutes: 30,
      }).success,
    ).toBe(true)
  })

  it('measure budgets in the home currency, keeping their amounts when it changes', () => {
    const account = (name: string, currency: 'AUD' | 'CNY') => {
      const result = createAccount(db, {
        name,
        type: 'bank',
        currency,
        openingBalanceCents: 0,
      })
      if (!result.ok) throw new Error('no account')
      return result.id
    }
    const aud = account('Fake Everyday', 'AUD')
    const cny = account('Fake Travel', 'CNY')
    const food = createCategory(db, { name: 'Fake Food', parentId: null })
    if (!food.ok) throw new Error('no category')
    for (const [accountId, amountCents] of [
      [aud, -1000],
      [cny, -5000],
    ]) {
      createTransaction(db, {
        accountId: accountId!,
        date: '2026-05-02',
        amountCents: amountCents!,
        description: 'Fake',
        categoryId: food.id,
        notes: '',
      })
    }
    setBudget(db, { categoryId: food.id, month: '2026-05', amountCents: 4000 })
    const before = monthBudgets(db, '2026-05')
    expect(before.currency).toBe('AUD')
    expect(before.categories[0]).toMatchObject({
      budgetCents: 4000,
      spentCents: 1000,
    })
    expect(before.otherCurrencies).toEqual([
      { currency: 'CNY', spentCents: 5000 },
    ])

    updateSettings(db, { homeCurrency: 'CNY' })
    const after = monthBudgets(db, '2026-05')
    expect(after.currency).toBe('CNY')
    expect(after.categories[0]).toMatchObject({
      budgetCents: 4000,
      spentCents: 5000,
    })
    expect(after.otherCurrencies).toEqual([
      { currency: 'AUD', spentCents: 1000 },
    ])
  })
})
