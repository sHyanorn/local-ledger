import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImportSession } from '../../src/main/import/session'
import { createAccount } from '../../src/main/ledger/accounts'
import {
  createCategory,
  deleteCategory,
  listCategories,
} from '../../src/main/ledger/categories'
import {
  applyRule,
  createRule,
  declineSuggestion,
  deleteRule,
  firstRule,
  listRules,
  matches,
  moveRule,
  payeeOf,
  ruleReach,
  suggestRule,
  updateRule,
} from '../../src/main/ledger/rules'
import { createTransaction } from '../../src/main/ledger/transactions'
import { openDatabase, type Db } from '../../src/main/vault/database'
import type { RuleMatch } from '../../src/shared/rules'

let dir: string
let db: Db
let accountId: number
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-rules-'))
  db = openDatabase(join(dir, 'ledger.db'), Buffer.alloc(32, 7), {
    create: true,
  })
  const account = createAccount(db, {
    name: 'Fake Everyday',
    type: 'bank',
    currency: 'AUD',
    openingBalanceCents: 0,
  })
  if (!account.ok) throw new Error('no account')
  accountId = account.id
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const category = (name: string, parentId: number | null = null) => {
  const result = createCategory(db, { name, parentId })
  if (!result.ok) throw new Error('no category')
  return result.id
}
const transaction = (description: string, categoryId: number | null = null) => {
  const result = createTransaction(db, {
    accountId,
    date: '2026-05-03',
    amountCents: -450,
    description,
    categoryId,
    notes: '',
  })
  if (!result.ok) throw new Error('no transaction')
  return result.id
}
const rule = (
  pattern: string,
  match: RuleMatch,
  categoryId: number,
  apply = false,
) => {
  const result = createRule(db, { pattern, match, categoryId, apply })
  if (!result.ok) throw new Error('no rule')
  return result
}
const categoryOf = (id: number) =>
  db
    .prepare('SELECT category_id AS c, edited FROM transactions WHERE id = ?')
    .get(id) as {
    c: number | null
    edited: number
  }

/** Commits as the page does: after previewing the same request. */
const previewAndCommit = (
  session: ImportSession,
  request: Parameters<ImportSession['commit']>[1],
) => {
  const { selected: _selected, ...shown } = request
  session.preview(db, shown)
  return session.commit(db, request)
}

describe('matching', () => {
  it.each([
    ['contains', 'fake cafe', 'fake cafe newtown', true],
    ['contains', 'Cafe  Newtown', 'fake cafe newtown', true],
    ['contains', 'bakery', 'fake cafe newtown', false],
    ['starts-with', 'FAKE', 'fake cafe newtown', true],
    ['starts-with', 'cafe', 'fake cafe newtown', false],
    ['is', 'Fake Cafe Newtown', 'fake cafe newtown', true],
    ['is', 'Fake Cafe', 'fake cafe newtown', false],
  ] as const)('%s %j against %j: %s', (match, pattern, key, expected) => {
    expect(matches({ pattern, match }, key)).toBe(expected)
  })

  it('takes the first rule that matches', () => {
    const coffee = category('Fake Coffee')
    const dining = category('Fake Dining')
    rule('cafe', 'contains', dining)
    rule('Fake Cafe Newtown', 'is', coffee)
    expect(firstRule(listRules(db), 'FAKE CAFE NEWTOWN')?.categoryId).toBe(
      coffee,
    )
    expect(firstRule(listRules(db), 'Other Cafe')?.categoryId).toBe(dining)
    expect(firstRule(listRules(db), 'Fake Bakery')).toBeNull()
  })
})

describe('order', () => {
  it('puts a new rule before the first less specific one', () => {
    const food = category('Fake Food')
    rule('cafe', 'contains', food)
    rule('fake cafe', 'contains', food)
    rule('fake', 'starts-with', food)
    rule('fake cafe newtown', 'is', food)
    rule('fake bakery', 'starts-with', food)
    expect(
      listRules(db).map((entry) => `${entry.match} ${entry.pattern}`),
    ).toEqual([
      'is fake cafe newtown',
      'starts-with fake bakery',
      'starts-with fake',
      'contains fake cafe',
      'contains cafe',
    ])
  })

  it('moves a rule one place either way, and not past the ends', () => {
    const food = category('Fake Food')
    const a = rule('aaa', 'contains', food).id
    const b = rule('bb', 'contains', food).id
    const c = rule('c', 'contains', food).id
    expect(moveRule(db, c, -1)).toEqual({ ok: true })
    expect(listRules(db).map((entry) => entry.id)).toEqual([a, c, b])
    expect(moveRule(db, a, -1)).toEqual({ ok: true })
    expect(moveRule(db, b, 1)).toEqual({ ok: true })
    expect(listRules(db).map((entry) => entry.id)).toEqual([a, c, b])
    expect(moveRule(db, 999, 1)).toEqual({ ok: false, reason: 'not-found' })
  })

  it('updates and deletes, refusing a missing category or rule', () => {
    const food = category('Fake Food')
    const id = rule('cafe', 'contains', food).id
    expect(
      updateRule(db, { id, pattern: 'Cafe', match: 'is', categoryId: food }),
    ).toEqual({ ok: true })
    expect(listRules(db)).toEqual([
      { id, pattern: 'Cafe', match: 'is', categoryId: food },
    ])
    expect(
      updateRule(db, { id, pattern: 'Cafe', match: 'is', categoryId: 999 }),
    ).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(
      createRule(db, {
        pattern: 'x',
        match: 'is',
        categoryId: 999,
        apply: false,
      }),
    ).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(deleteRule(db, id)).toEqual({ ok: true })
    expect(deleteRule(db, id)).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('applying', () => {
  it('categorizes only uncategorized transactions it matches first', () => {
    const coffee = category('Fake Coffee')
    const dining = category('Fake Dining')
    const set = transaction('Fake Cafe Newtown', dining)
    const open = transaction('Fake Cafe Newtown')
    const taken = transaction('Fake Cafe Bondi')
    const other = transaction('Fake Bakery')
    rule('fake cafe bondi', 'is', dining)
    const { id, applied } = rule('fake cafe', 'contains', coffee, true)
    expect(applied).toBe(1)
    expect(categoryOf(set)).toEqual({ c: dining, edited: 0 })
    expect(categoryOf(open)).toEqual({ c: coffee, edited: 1 })
    expect(categoryOf(taken)).toEqual({ c: null, edited: 0 })
    expect(categoryOf(other)).toEqual({ c: null, edited: 0 })
    expect(applyRule(db, id)).toBe(0)
  })

  it('measures what a rule would reach at its place', () => {
    const coffee = category('Fake Coffee')
    transaction('Fake Cafe Newtown', coffee)
    transaction('Fake Cafe Newtown')
    transaction('Fake Cafe Bondi')
    transaction('Fake Bakery')
    rule('fake cafe bondi', 'is', coffee)
    expect(ruleReach(db, { pattern: 'fake cafe', match: 'contains' })).toEqual({
      matches: 3,
      taken: 1,
      uncategorized: 1,
    })
    // An existing rule is measured where it stands.
    const first = listRules(db)[0]!
    expect(ruleReach(db, { ...first })).toEqual({
      matches: 1,
      taken: 0,
      uncategorized: 1,
    })
  })

  it('gives imported rows the category of their first matching rule', () => {
    const coffee = category('Fake Coffee')
    rule('fake cafe', 'contains', coffee)
    const session = new ImportSession()
    const opened = session.open(
      db,
      'file.csv',
      new TextEncoder().encode(
        '03/05/2026,-4.50,FAKE CAFE NEWTOWN,1\n04/05/2026,-2.00,Fake Bakery,1\n',
      ),
    )
    if (!opened.ok) throw new Error(opened.reason)
    const request = {
      id: opened.file.id,
      encoding: opened.file.encoding,
      mapping: opened.file.mapping!,
      targets: [{ key: '', accountId }],
    }
    const preview = session.preview(db, request)
    expect(
      preview.ok && preview.preview.rows.map((row) => row.categoryId),
    ).toEqual([coffee, null])
    previewAndCommit(session, { ...request, selected: [0, 1] })
    expect(
      db
        .prepare(
          'SELECT category_id AS c, edited FROM transactions ORDER BY id',
        )
        .all(),
    ).toEqual([
      { c: coffee, edited: 0 },
      { c: null, edited: 0 },
    ])
  })
})

describe('suggestions', () => {
  it.each([
    [
      'FAKE MARKET STALL SYDNEY NS AUS Card xx0000 Value Date: 27/05/2026',
      'FAKE MARKET STALL SYDNEY NS AUS',
    ],
    ['EFTPOS 7-ELEVEN 2190 SYDNEY', 'EFTPOS 7-ELEVEN SYDNEY'],
    ['Direct Debit 123456 FAKE GYM', 'Direct Debit FAKE GYM'],
    ['123456', '123456'],
  ])('takes the payee of %j', (description, payee) => {
    expect(payeeOf(description)).toBe(payee)
  })

  it('offers a rule when another transaction has the same payee', () => {
    const coffee = category('Fake Coffee')
    transaction('FAKE CAFE NEWTOWN Card xx0000 Value Date: 01/05/2026')
    const changed = transaction(
      'FAKE CAFE NEWTOWN Card xx0000 Value Date: 02/05/2026',
      coffee,
    )
    expect(suggestRule(db, changed)).toEqual({
      pattern: 'FAKE CAFE NEWTOWN',
      match: 'contains',
      categoryId: coffee,
      matches: 2,
      rule: null,
    })
  })

  it('stays quiet for a single transaction, no category, a rule that agrees, or a declined payee', () => {
    const coffee = category('Fake Coffee')
    const alone = transaction('Fake Lone Shop', coffee)
    expect(suggestRule(db, alone)).toBeNull()

    transaction('Fake Cafe Newtown')
    const none = transaction('Fake Cafe Newtown')
    expect(suggestRule(db, none)).toBeNull()

    const changed = transaction('Fake Cafe Newtown', coffee)
    rule('fake cafe', 'contains', coffee)
    expect(suggestRule(db, changed)).toBeNull()

    const tea = category('Fake Tea')
    transaction('Fake Tea House')
    const tea2 = transaction('Fake Tea House', tea)
    declineSuggestion(db, 'FAKE  tea house')
    expect(suggestRule(db, tea2)).toBeNull()
    expect(suggestRule(db, 999)).toBeNull()
  })

  it('offers to update the rule that puts the payee elsewhere', () => {
    const coffee = category('Fake Coffee')
    const dining = category('Fake Dining')
    const existing = rule('fake cafe', 'contains', dining).id
    transaction('Fake Cafe Newtown', dining)
    const changed = transaction('Fake Cafe Newtown', coffee)
    expect(suggestRule(db, changed)?.rule).toEqual({
      id: existing,
      pattern: 'fake cafe',
      match: 'contains',
      categoryId: dining,
    })
  })
})

describe('deleting a category', () => {
  it('counts its rules, and deletes them with it and its subcategories', () => {
    const food = category('Fake Food')
    const coffee = category('Fake Coffee', food)
    rule('fake cafe', 'contains', coffee)
    rule('fake market', 'contains', food)
    rule('fake bakery', 'contains', food)
    const counts = Object.fromEntries(
      listCategories(db).map((entry) => [entry.name, entry.ruleCount]),
    )
    expect(counts).toEqual({ 'Fake Coffee': 1, 'Fake Food': 2 })
    deleteCategory(db, food)
    expect(listRules(db)).toEqual([])
  })
})
