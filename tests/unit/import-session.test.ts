import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listBatches, undoBatch } from '../../src/main/import/batches'
import { classify, fingerprints, similarity } from '../../src/main/import/dedup'
import { ImportSession } from '../../src/main/import/session'
import { createAccount } from '../../src/main/ledger/accounts'
import {
  createTransaction,
  setTransactionCategory,
  updateTransaction,
} from '../../src/main/ledger/transactions'
import { createCategory } from '../../src/main/ledger/categories'
import { openDatabase, type Db } from '../../src/main/vault/database'
import type { ImportFile, Mapping } from '../../src/shared/imports'

let dir: string
let db: Db
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-import-'))
  db = openDatabase(join(dir, 'ledger.db'), Buffer.alloc(32, 7), {
    create: true,
  })
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const account = (name = 'Fake Everyday') => {
  const result = createAccount(db, {
    name,
    type: 'bank',
    currency: 'AUD',
    openingBalanceCents: 0,
  })
  if (!result.ok) throw new Error('no account')
  return result.id
}
const manual = (
  accountId: number,
  date: string,
  amountCents: number,
  description: string,
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
const bytes = (text: string) => new TextEncoder().encode(text)
const sample = (name: string) =>
  readFileSync(join(__dirname, '../fixtures/csv', name))
const rows = () =>
  db
    .prepare(
      'SELECT account_id AS accountId, date, amount_cents AS cents, description, import_batch_id AS batch FROM transactions ORDER BY id',
    )
    .all()

function opened(
  session: ImportSession,
  data: Uint8Array,
  name = 'file.csv',
): ImportFile {
  const result = session.open(db, name, data)
  if (!result.ok) throw new Error(result.reason)
  return result.file
}
const request = (file: ImportFile, accountId: number, mapping?: Mapping) => ({
  id: file.id,
  encoding: file.encoding,
  mapping: mapping ?? file.mapping!,
  targets: [{ key: '', accountId }],
})
const everything = (
  session: ImportSession,
  file: ImportFile,
  accountId: number,
) => {
  const preview = session.preview(db, request(file, accountId))
  if (!preview.ok) throw new Error(preview.reason)
  return preview.preview.rows.map((row) => row.index)
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

describe('fingerprints', () => {
  const row = {
    index: 0,
    accountId: 1,
    date: '2026-05-03',
    cents: -450,
    description: 'Fake Cafe',
  }

  it('counts identical rows instead of merging them', () => {
    const [first, second, other] = fingerprints([
      row,
      { ...row, index: 1 },
      { ...row, index: 2, cents: -451 },
    ])
    expect(first).not.toBe(second)
    expect(other).not.toBe(first)
    expect(fingerprints([row, row])).toEqual([first, second])
  })

  it('ignores case and spacing in the description', () => {
    expect(fingerprints([{ ...row, description: 'FAKE  cafe' }])).toEqual(
      fingerprints([row]),
    )
  })

  it('counts each account separately', () => {
    const prints = fingerprints([row, { ...row, accountId: 2 }])
    expect(prints[0]).toBe(prints[1])
  })
})

describe('similarity', () => {
  it('is the share of words in common', () => {
    const words = (text: string) =>
      new Set(text.toLowerCase().split(' ').filter(Boolean))
    expect(
      similarity(words('Fake Cafe Newtown'), words('fake cafe')),
    ).toBeCloseTo(2 / 3)
    expect(similarity(words('Fake Cafe'), words('Other Shop'))).toBe(0)
    expect(similarity(new Set(), new Set())).toBe(0)
  })
})

describe('classify', () => {
  it('flags a hand-entered transaction once, leaving the other alike row new', () => {
    const everyday = account()
    const existing = manual(everyday, '2026-05-02', -450, 'Fake Cafe')
    const incoming = [0, 1].map((index) => ({
      index,
      accountId: everyday,
      date: '2026-05-03',
      cents: -450,
      description: 'FAKE CAFE NEWTOWN',
    }))
    const result = classify(db, incoming)
    expect(result.map((entry) => entry.status)).toEqual(['possible', 'new'])
    expect(result[0]?.match).toEqual({
      id: existing,
      date: '2026-05-02',
      amountCents: -450,
      description: 'Fake Cafe',
    })
  })

  it('matches the closest date first, then the most alike description', () => {
    const everyday = account()
    manual(everyday, '2026-05-07', -450, 'Fake Cafe')
    const near = manual(everyday, '2026-05-04', -450, 'Something Else')
    const alike = manual(everyday, '2026-05-02', -450, 'Fake Cafe')
    const result = classify(db, [
      {
        index: 0,
        accountId: everyday,
        date: '2026-05-03',
        cents: -450,
        description: 'Fake Cafe',
      },
    ])
    expect(result[0]?.match?.id).toBe(alike)
    expect(near).toBeGreaterThan(0)
  })

  it('ranks by date, then wording, whatever order the ledger holds them in', () => {
    const everyday = account()
    // Inserted farthest first, so the table's own order is the wrong one.
    manual(everyday, '2026-05-06', -450, 'Fake Cafe')
    const reworded = manual(everyday, '2026-05-03', -450, 'Other Words')
    const alike = manual(everyday, '2026-05-03', -450, 'Fake Cafe')
    const result = classify(db, [
      {
        index: 0,
        accountId: everyday,
        date: '2026-05-03',
        cents: -450,
        description: 'Fake Cafe',
      },
      {
        index: 1,
        accountId: everyday,
        date: '2026-05-03',
        cents: -450,
        description: 'Other Words',
      },
    ])
    expect(result.map((entry) => entry.match?.id)).toEqual([alike, reworded])
  })

  it('looks at the nearest few candidates only, so many alike rows stay fast', () => {
    const everyday = account()
    const insert = db.prepare(
      "INSERT INTO transactions (account_id, date, amount_cents, description) VALUES (?, '2026-05-03', -100, 'Fake Same')",
    )
    db.transaction(() => {
      for (let i = 0; i < 3000; i++) insert.run(everyday)
    })()
    const incoming = Array.from({ length: 3000 }, (_, index) => ({
      index,
      accountId: everyday,
      date: '2026-05-03',
      cents: -100,
      description: `Fake Same ${index}`,
    }))
    const started = performance.now()
    const result = classify(db, incoming)
    // Comparing every pair took over 20 s here; a shared CI machine can be
    // slower than a laptop, so the bound is loose.
    expect(performance.now() - started).toBeLessThan(10_000)
    expect(
      result.filter((entry) => entry.status === 'possible').length,
    ).toBeGreaterThan(0)
  })

  it('finds a hand-entered match past ten rows matched exactly', () => {
    const everyday = account()
    const session = new ImportSession()
    const text = Array.from(
      { length: 10 },
      (_, index) => `03/05/2026,-4.50,Fake Same ${index},1`,
    ).join('\n')
    const first = opened(session, bytes(text))
    previewAndCommit(session, {
      ...request(first, everyday),
      selected: [...Array(10).keys()],
    })
    const hand = manual(everyday, '2026-05-05', -450, 'Fake Typed By Hand')
    const result = classify(db, [
      ...Array.from({ length: 10 }, (_, index) => ({
        index,
        accountId: everyday,
        date: '2026-05-03',
        cents: -450,
        description: `Fake Same ${index}`,
      })),
      {
        index: 10,
        accountId: everyday,
        date: '2026-05-03',
        cents: -450,
        description: 'Fake New Wording',
      },
    ])
    expect(result[10]).toMatchObject({
      status: 'possible',
      match: { id: hand },
    })
  })

  it('offers every alike row a candidate when there are more than ten', () => {
    const everyday = account()
    for (let i = 0; i < 14; i++)
      manual(everyday, '2026-05-03', -450, 'Fake Old Wording')
    const result = classify(
      db,
      Array.from({ length: 14 }, (_, index) => ({
        index,
        accountId: everyday,
        date: '2026-05-03',
        cents: -450,
        description: 'Fake New Wording',
      })),
    )
    expect(result.every((entry) => entry.status === 'possible')).toBe(true)
  })

  it('ignores other amounts, other accounts, and dates more than four days apart', () => {
    const everyday = account()
    const savings = account('Fake Savings')
    manual(everyday, '2026-05-03', -451, 'Fake Cafe')
    manual(savings, '2026-05-03', -450, 'Fake Cafe')
    manual(everyday, '2026-04-28', -450, 'Fake Cafe')
    manual(everyday, '2026-05-08', -450, 'Fake Cafe')
    const result = classify(db, [
      {
        index: 0,
        accountId: everyday,
        date: '2026-05-03',
        cents: -450,
        description: 'Fake Cafe',
      },
    ])
    expect(result[0]?.status).toBe('new')
    const edge = manual(everyday, '2026-05-07', -450, 'Fake Cafe')
    expect(
      classify(db, [
        {
          index: 0,
          accountId: everyday,
          date: '2026-05-03',
          cents: -450,
          description: 'Fake Cafe',
        },
      ])[0]?.match?.id,
    ).toBe(edge)
  })
})

describe('ImportSession', () => {
  it('imports a bank file, then finds every row already there', () => {
    const everyday = account()
    const session = new ImportSession()
    const file = opened(session, sample('commbank.csv'), 'commbank.csv')
    expect(file).toMatchObject({
      template: 'commbank',
      encoding: 'utf-8',
      columns: 4,
      groups: null,
    })
    expect(file.sample).toHaveLength(6)

    const committed = previewAndCommit(session, {
      ...request(file, everyday),
      selected: everything(session, file, everyday),
    })
    expect(committed).toEqual({ ok: true, id: 1, count: 6, paired: 0 })
    expect(rows()).toHaveLength(6)
    // Two alike purchases on 3 May are both kept.
    expect(
      rows().filter((row) => (row as { date: string }).date === '2026-05-03'),
    ).toHaveLength(2)

    const again = opened(session, sample('commbank.csv'))
    const preview = session.preview(db, request(again, everyday))
    expect(preview.ok && preview.preview.rows.map((row) => row.status)).toEqual(
      Array(6).fill('duplicate'),
    )
    expect(
      previewAndCommit(session, {
        ...request(again, everyday),
        selected: [0, 1, 2, 3, 4, 5],
      }),
    ).toEqual({
      ok: false,
      reason: 'nothing',
    })
  })

  it('imports a third alike row from a later, overlapping file', () => {
    const everyday = account()
    const session = new ImportSession()
    const line = '03/05/2026,"-4.50","Fake Cafe","+1.00"\n'
    const first = opened(session, bytes(line.repeat(2)))
    previewAndCommit(session, { ...request(first, everyday), selected: [0, 1] })
    const second = opened(session, bytes(line.repeat(3)))
    const preview = session.preview(db, request(second, everyday))
    expect(preview.ok && preview.preview.rows.map((row) => row.status)).toEqual(
      ['duplicate', 'duplicate', 'new'],
    )
  })

  it('imports only the selected rows, and lists the errors', () => {
    const everyday = account()
    const session = new ImportSession()
    const file = opened(
      session,
      bytes(
        '01/05/2026,-1.00,Fake A,1\n31/02/2026,-2.00,Fake B,1\n02/05/2026,-3.00,Fake C,1\n',
      ),
    )
    const preview = session.preview(db, request(file, everyday))
    expect(preview.ok && preview.preview.errors).toEqual([
      { line: 2, problem: 'date', value: '31/02/2026' },
    ])
    expect(preview.ok && preview.preview.rows.map((row) => row.index)).toEqual([
      0, 1,
    ])
    previewAndCommit(session, { ...request(file, everyday), selected: [1] })
    expect(rows()).toMatchObject([{ description: 'Fake C' }])
  })

  it('refuses a commit whose settings changed since the preview', () => {
    const everyday = account()
    const savings = account('Fake Savings')
    manual(everyday, '2026-05-03', -450, 'Fake Cafe')
    const session = new ImportSession()
    const file = opened(
      session,
      bytes('03/05/2026,-4.50,Fake Cafe,1\n13/05/2026,-1.00,Fake Two,1\n'),
    )
    session.preview(db, request(file, savings))
    // Previewed for one account, sent for another: the indexes no longer
    // name what the user saw.
    expect(
      session.commit(db, { ...request(file, everyday), selected: [0] }),
    ).toEqual({ ok: false, reason: 'changed' })
    const swapped: Mapping = { ...file.mapping!, dateOrder: 'mdy' }
    expect(
      session.commit(db, { ...request(file, savings, swapped), selected: [0] }),
    ).toEqual({ ok: false, reason: 'changed' })
    expect(rows()).toHaveLength(1)
    expect(
      session.commit(db, { ...request(file, savings), selected: [0] }),
    ).toMatchObject({ ok: true, count: 1 })
  })

  it('imports a possible duplicate only when selected', () => {
    const everyday = account()
    manual(everyday, '2026-05-03', -450, 'Fake Cafe')
    const session = new ImportSession()
    const file = opened(session, bytes('03/05/2026,-4.50,FAKE CAFE,1\n'))
    const preview = session.preview(db, request(file, everyday))
    expect(preview.ok && preview.preview.rows[0]?.status).toBe('possible')
    previewAndCommit(session, { ...request(file, everyday), selected: [0] })
    expect(rows()).toHaveLength(2)
  })

  it('lists no errors from an account that is skipped', () => {
    const everyday = account()
    const session = new ImportSession()
    const text =
      'Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n' +
      '1111,29/05/2026,Fake Kept,1.00,,1,OTHER,\n' +
      '2222,31/02/2026,Fake Skipped Bad Date,1.00,,1,OTHER,\n'
    const file = opened(session, bytes(text))
    const preview = session.preview(db, {
      ...request(file, everyday),
      targets: [
        { key: '1111', accountId: everyday },
        { key: '2222', accountId: null },
      ],
    })
    expect(preview.ok && preview.preview).toMatchObject({
      rows: [{ description: 'Fake Kept' }],
      errors: [],
    })
  })

  it('splits a file of several accounts, and skips an account given none', () => {
    const everyday = account()
    const session = new ImportSession()
    const file = opened(session, sample('westpac.csv'))
    expect(file.groups).toEqual([
      { key: '000000000001', rows: 2 },
      { key: '0000', rows: 2 },
    ])
    const targets = [
      { key: '000000000001', accountId: everyday },
      { key: '0000', accountId: null },
    ]
    const preview = session.preview(db, { ...request(file, everyday), targets })
    expect(
      preview.ok && preview.preview.rows.map((row) => row.description),
    ).toEqual(['FAKE MARKET STALL SYDNEY AU', 'DEPOSIT FAKE EMPLOYER PTY LTD'])
  })

  it('rereads the file in another encoding', () => {
    const everyday = account()
    const session = new ImportSession()
    const file = opened(session, bytes('01/05/2026,-1.00,Café,1\n'))
    const preview = session.preview(db, {
      ...request(file, everyday),
      encoding: 'windows-1252',
    })
    expect(preview.ok && preview.preview.rows[0]?.description).toBe('CafÃ©')
  })

  it('refuses a request for another file or a missing account', () => {
    const everyday = account()
    const session = new ImportSession()
    const file = opened(session, sample('anz.csv'))
    expect(
      session.preview(db, {
        ...request(file, everyday),
        id: crypto.randomUUID(),
      }),
    ).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(session.preview(db, request(file, everyday + 1))).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it('reports a file it cannot read, and zeroes its bytes', () => {
    const session = new ImportSession()
    const data = bytes('a,"b\n')
    expect(session.open(db, 'bad.csv', data)).toEqual({
      ok: false,
      reason: 'not-csv',
    })
    expect(data.every((byte) => byte === 0)).toBe(true)
  })

  it('drops the waiting file and zeroes its bytes when cleared or replaced', () => {
    const everyday = account()
    const session = new ImportSession()
    const data = Uint8Array.from(sample('anz.csv'))
    const file = opened(session, data)
    opened(session, sample('nab.csv'))
    expect(data.every((byte) => byte === 0)).toBe(true)
    expect(session.preview(db, request(file, everyday)).ok).toBe(false)
    session.clear()
    expect(
      previewAndCommit(session, { ...request(file, everyday), selected: [0] }),
    ).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it('remembers changed columns for files with the same header, and forgets them on return', () => {
    const everyday = account()
    const session = new ImportSession()
    const text =
      'Posted,Details,Money Out,Money In,Balance\n2026-05-29,Fake Market Stall,15.26,,1234.56\n'
    const file = opened(session, bytes(text))
    const changed: Mapping = { ...file.mapping!, description: [1, 4] }
    previewAndCommit(session, {
      ...request(file, everyday, changed),
      selected: [0],
    })
    expect(opened(session, bytes(text)).mapping).toEqual(changed)

    const later = text.replace('2026-05-29', '2026-05-30')
    const reopened = opened(session, bytes(later))
    const detected: Mapping = { ...changed, description: [1] }
    previewAndCommit(session, {
      ...request(reopened, everyday, detected),
      selected: [0],
    })
    expect(opened(session, bytes(text)).mapping?.description).toEqual([1])
    expect(
      db.prepare('SELECT count(*) AS n FROM import_mappings').get(),
    ).toEqual({ n: 0 })
  })

  it('ignores a remembered mapping that no longer validates', () => {
    const session = new ImportSession()
    const text =
      'Posted,Details,Money Out,Money In,Balance\n2026-05-29,Fake,15.26,,1\n'
    db.prepare('INSERT INTO import_mappings VALUES (?, ?)').run(
      'posted\u001fdetails\u001fmoney out\u001fmoney in\u001fbalance',
      '{"header":true,"date":99}',
    )
    expect(opened(session, bytes(text)).mapping?.date).toBe(0)
  })
})

describe('import history', () => {
  it('counts edited transactions and undoes an import', () => {
    const everyday = account()
    const groceries = createCategory(db, {
      name: 'Fake Groceries',
      parentId: null,
    })
    if (!groceries.ok) throw new Error('no category')
    const session = new ImportSession()
    const file = opened(session, sample('anz.csv'), 'anz.csv')
    previewAndCommit(session, {
      ...request(file, everyday),
      selected: everything(session, file, everyday),
    })
    const kept = manual(everyday, '2026-05-01', -100, 'Fake Kept')

    const ids = (
      db
        .prepare(
          'SELECT id FROM transactions WHERE import_batch_id = 1 ORDER BY id',
        )
        .all() as { id: number }[]
    ).map((row) => row.id)
    setTransactionCategory(db, ids[0]!, groceries.id)
    // Saving unchanged fields is not an edit.
    const second = db
      .prepare(
        'SELECT account_id AS accountId, date, amount_cents AS amountCents, description FROM transactions WHERE id = ?',
      )
      .get(ids[1]) as {
      accountId: number
      date: string
      amountCents: number
      description: string
    }
    updateTransaction(db, {
      id: ids[1]!,
      ...second,
      categoryId: null,
      notes: '',
    })
    setTransactionCategory(db, ids[2]!, null)
    // A note alone is a change.
    const third = db
      .prepare(
        'SELECT account_id AS accountId, date, amount_cents AS amountCents, description FROM transactions WHERE id = ?',
      )
      .get(ids[2]) as typeof second
    updateTransaction(db, {
      id: ids[2]!,
      ...third,
      categoryId: null,
      notes: 'Fake note',
    })

    expect(listBatches(db)).toMatchObject([
      { id: 1, fileName: 'anz.csv', count: 3, edited: 2 },
    ])
    expect(undoBatch(db, 1)).toEqual({ ok: true, count: 3 })
    expect(rows()).toMatchObject([{ description: 'Fake Kept' }])
    expect(kept).toBeGreaterThan(0)
    expect(listBatches(db)).toEqual([])
    expect(undoBatch(db, 1)).toEqual({ ok: false, reason: 'not-found' })
  })

  it('lets a deleted import be imported again', () => {
    const everyday = account()
    const session = new ImportSession()
    const file = opened(session, sample('anz.csv'))
    previewAndCommit(session, {
      ...request(file, everyday),
      selected: everything(session, file, everyday),
    })
    undoBatch(db, 1)
    const again = opened(session, sample('anz.csv'))
    const preview = session.preview(db, request(again, everyday))
    expect(
      preview.ok && preview.preview.rows.every((row) => row.status === 'new'),
    ).toBe(true)
  })
})
