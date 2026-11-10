import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startsLikeFormula } from '../../src/main/export/formula'
import { PDF_TITLE, statementPage } from '../../src/main/export/report-page'
import { statement, statementSheets } from '../../src/main/export/statement'
import {
  columnName,
  dateSerial,
  workbook,
  xmlText,
  type Sheet,
} from '../../src/main/export/xlsx'
import { createAccount } from '../../src/main/ledger/accounts'
import { setBudget } from '../../src/main/ledger/budgets'
import { createCategory } from '../../src/main/ledger/categories'
import { createTransaction } from '../../src/main/ledger/transactions'
import { pairTransfers } from '../../src/main/ledger/transfers'
import type { Db } from '../../src/main/vault/database'
import { schemas } from '../../src/shared/schemas'
import { tempDatabase, type TempDatabase } from '../support/temp-database'

// OWASP's formula starts, and the full-width forms Excel also reads.
const DANGEROUS = [
  '=1+1',
  '+1+1',
  '-1+1',
  '@SUM(A1)',
  '\tTab',
  '\rReturn',
  '\nLine',
  '＝1+1',
  '＋1+1',
  '－1+1',
  '＠SUM(A1)',
  '=HYPERLINK("http://example.invalid","x")',
]
// A character XML cannot hold must not hide a formula start behind it.
const HIDDEN = ['\uFFFE=1+1', '\u0001=HYPERLINK("x")', '\uFFFF\u0000@SUM(A1)']
const SAFE = ['Fake Cafe', ' =1+1', "'=1+1", '1+1', 'a=b', '', '中文 Fake']

describe('formula starts', () => {
  it.each(DANGEROUS)('%j starts like a formula', (text) => {
    expect(startsLikeFormula(text)).toBe(true)
  })
  it.each(SAFE)('%j does not', (text) => {
    expect(startsLikeFormula(text)).toBe(false)
  })
})

describe('xlsx parts', () => {
  it('escapes XML and Excel escapes, drops what XML cannot hold', () => {
    expect(xmlText('a & <b> "c"')).toBe('a &#38; &#60;b&#62; &#34;c&#34;')
    expect(xmlText('_x0041_ and _X_')).toBe('_x005F_x0041_ and _X_')
    expect(xmlText('a\rb\nc\td')).toBe('a&#13;b\nc\td')
    expect(xmlText('a\u0000b\u0008c\u001Fd￾')).toBe('abcd')
    expect(xmlText('lone \uD800 high')).toBe('lone � high')
    expect(xmlText('emoji 😀')).toBe('emoji 😀')
  })
  it.each([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [701, 'ZZ'],
    [702, 'AAA'],
  ])('column %d is %s', (index, name) => {
    expect(columnName(index)).toBe(name)
  })
  it('dates are serials after 1899-12-30', () => {
    expect(dateSerial('1900-03-01')).toBe(61)
    expect(dateSerial('2026-11-08')).toBe(46334)
  })
})

/** The worksheets' XML from xlsx bytes, and every part's name. */
function open(bytes: Uint8Array) {
  const parts = unzipSync(bytes)
  const sheets = Object.keys(parts)
    .filter((name) => name.startsWith('xl/worksheets/'))
    .sort()
    .map((name) => strFromU8(parts[name]!))
  return { names: Object.keys(parts).sort(), sheets, parts }
}

/** Each cell's reference, style, type and text or value. */
function cells(xml: string) {
  return [
    ...xml.matchAll(
      /<c r="([A-Z]+\d+)" s="(\d+)"(?: t="(\w+)")?>(?:<is><t xml:space="preserve">([\s\S]*?)<\/t><\/is>|<v>(.*?)<\/v>)<\/c>/g,
    ),
  ].map(([, ref, style, type, text, value]) => ({
    ref,
    style: Number(style),
    type: type ?? 'n',
    content: text ?? value,
  }))
}

const unescape = (text: string) =>
  text.replace(/&#(\d+);/g, (_, code: string) =>
    String.fromCharCode(Number(code)),
  )

describe('workbook', () => {
  const sheet: Sheet = {
    name: 'Fake',
    widths: [20, 12, 12],
    freezeHeader: true,
    rows: [
      { cells: ['Text', 'Date', 'Amount'], bold: true },
      ...[...DANGEROUS, ...SAFE].map((text) => ({
        cells: [text, { date: '2026-11-08' }, { cents: -123456 }],
      })),
      { cells: [null, null, { cents: 5 }] },
    ],
  }

  it('writes text as inline strings, never formulas, quoting formula starts', () => {
    const { names, sheets, parts } = open(workbook([sheet]))
    expect(names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ])
    const xml = sheets[0]!
    expect(xml).not.toMatch(/<f[ >]/)
    const styles = strFromU8(parts['xl/styles.xml']!)
    const xfs = [...styles.split('<cellXfs')[1]!.matchAll(/<xf [^>]*\/>/g)].map(
      ([xf]) => xf,
    )
    const all = cells(xml)
    const column = (letter: string) =>
      all.filter(
        (cell) => cell.ref!.startsWith(letter) && cell.ref !== `${letter}1`,
      )
    const texts = column('A')
    expect(texts.map((cell) => unescape(cell.content!))).toEqual([
      ...DANGEROUS,
      ...SAFE,
    ])
    for (const cell of texts) {
      expect(cell.type).toBe('inlineStr')
      const xf = xfs[cell.style]!
      expect(xf).toContain('numFmtId="49"')
      expect(xf.includes('quotePrefix="1"')).toBe(
        startsLikeFormula(unescape(cell.content!)),
      )
    }
    for (const cell of column('B')) {
      expect(cell).toMatchObject({ type: 'n', content: '46334' })
      expect(xfs[cell.style]).toContain('numFmtId="164"')
    }
    expect(column('C').map((cell) => cell.content)).toContain('-1234.56')
    expect(column('C').at(-1)?.content).toBe('0.05')
    expect(xfs[all[0]!.style]).toContain('fontId="1"')
    expect(xml).toContain('state="frozen"')
  })

  it('quotes a formula start behind characters XML drops', () => {
    const { sheets, parts } = open(
      workbook([
        {
          name: 'Fake',
          widths: [],
          rows: HIDDEN.map((text) => ({ cells: [text] })),
        },
      ]),
    )
    const styles = strFromU8(parts['xl/styles.xml']!)
    const xfs = [...styles.split('<cellXfs')[1]!.matchAll(/<xf [^>]*\/>/g)]
    const written = cells(sheets[0]!)
    expect(written.map((cell) => unescape(cell.content!))).toEqual([
      '=1+1',
      '=HYPERLINK("x")',
      '@SUM(A1)',
    ])
    for (const cell of written) {
      expect(xfs[cell.style]![0]).toContain('quotePrefix="1"')
    }
  })

  it('is the same bytes for the same sheets, and refuses bad sheet names', () => {
    expect(workbook([sheet])).toEqual(workbook([sheet]))
    for (const name of ['', 'a/b', 'a[1]', 'x'.repeat(32)]) {
      expect(() => workbook([{ ...sheet, name }])).toThrow()
    }
    expect(() => workbook([])).toThrow()
  })
})

describe('statement', () => {
  let temp: TempDatabase
  let db: Db
  const ids: Record<string, number> = {}
  beforeEach(() => {
    temp = tempDatabase('ledger-export-')
    db = temp.db
    for (const [name, currency] of [
      ['Fake Everyday', 'AUD'],
      ['=Fake Savings', 'AUD'],
      ['Fake Travel', 'CNY'],
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
      ['Fake Food', null],
      ['Fake Coffee', 'Fake Food'],
    ] as const) {
      const result = createCategory(db, {
        name,
        parentId: parent ? ids[parent]! : null,
      })
      if (!result.ok) throw new Error('no category')
      ids[name] = result.id
    }
  })
  afterEach(() => temp.dispose())
  const add = (
    account: string,
    date: string,
    amountCents: number,
    description: string,
    category: string | null = null,
  ) => {
    const result = createTransaction(db, {
      accountId: ids[account]!,
      date,
      amountCents,
      description,
      categoryId: category ? ids[category]! : null,
      notes: '',
    })
    if (!result.ok) throw new Error('no transaction')
  }

  it('lists the month in one currency with transfers marked, and budgets for the home currency', () => {
    add('Fake Everyday', '2026-11-02', -450, '=cmd|calc', 'Fake Coffee')
    add('Fake Everyday', '2026-11-03', -10000, 'Fake transfer out')
    add('=Fake Savings', '2026-11-03', 10000, 'Fake transfer in')
    add('Fake Everyday', '2026-10-31', -999, 'Fake October')
    add('Fake Travel', '2026-11-04', -2000, 'Fake noodles', 'Fake Food')
    pairTransfers(db)
    setBudget(db, {
      categoryId: ids['Fake Food']!,
      month: '2026-11',
      amountCents: 400,
    })

    const aud = statement(db, '2026-11', 'AUD')
    expect(aud.rows.map((row) => [row.description, row.category])).toEqual([
      ['=cmd|calc', 'Fake Food › Fake Coffee'],
      ['Fake transfer out', 'Transfer › =Fake Savings'],
      ['Fake transfer in', 'Transfer › Fake Everyday'],
    ])
    expect(aud.report.spendingCents).toBe(450)
    expect(aud.budgets).toEqual([
      {
        categoryId: ids['Fake Food'],
        name: 'Fake Food',
        budgetCents: 400,
        spentCents: 450,
      },
    ])
    const sheets = statementSheets(aud)
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Budgets',
      'Transactions',
    ])
    expect(sheets[1]!.rows[1]!.cells.at(-1)).toBe('Over')

    const cny = statement(db, '2026-11', 'CNY')
    expect(cny.budgets).toEqual([])
    expect(cny.rows).toHaveLength(1)
    expect(statementSheets(cny).map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Transactions',
    ])

    // User text that starts like a formula is quoted in the file.
    const { sheets: xml, parts } = open(workbook(statementSheets(aud)))
    const styles = strFromU8(parts['xl/styles.xml']!)
    const xfs = [...styles.split('<cellXfs')[1]!.matchAll(/<xf [^>]*\/>/g)]
    const quoted = cells(xml[2]!).filter((cell) =>
      xfs[cell.style]![0].includes('quotePrefix'),
    )
    expect(quoted.map((cell) => unescape(cell.content!))).toEqual([
      '=cmd|calc',
      '=Fake Savings',
    ])
  })

  it('prints as a page with no scripts, escaping every text', () => {
    add(
      'Fake Everyday',
      '2026-11-02',
      -450,
      '<script>alert(1)</script>',
      'Fake Coffee',
    )
    add('Fake Everyday', '2026-11-03', -100, 'Fake "quoted" & <b>bold</b>')
    const html = statementPage(statement(db, '2026-11', 'AUD'))
    expect(html).not.toMatch(/<script|<iframe|<img|<object|style=|on\w+=/i)
    expect(html).toContain('&#60;script&#62;alert(1)&#60;/script&#62;')
    expect(html).toContain(
      'Fake &#34;quoted&#34; &#38; &#60;b&#62;bold&#60;/b&#62;',
    )
    expect(html).toContain(`<title>${PDF_TITLE}</title>`)
    expect(html).toContain('<link rel="stylesheet" href="report.css">')

    const empty = statementPage(statement(db, '2027-03', 'AUD'))
    expect(empty).toContain('No transactions')
    expect(empty).toContain('No spending')
  })
})

describe('report stylesheet', () => {
  // The first value of each custom property: the light scheme in the page's
  // stylesheet, the only one in the report's.
  const colours = (file: string) => {
    const css = readFileSync(resolve(__dirname, '../../src', file), 'utf8')
    return (name: string) =>
      new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(css)?.[1]
  }
  const report = colours('main/export/report.css')
  const page = colours('renderer/src/index.css')

  it.each([
    ['muted', '#636366'],
    ['positive', '#1f7a36'],
  ])('prints %s text in the colour the page uses', (name, colour) => {
    expect(page(name)).toBe(colour)
    expect(report(name)).toBe(colour)
  })
})

describe('export payloads', () => {
  it('take a month, a known currency and xlsx or pdf only', () => {
    const valid = { month: '2026-11', currency: 'AUD', format: 'pdf' }
    expect(schemas.exportSave.safeParse(valid).success).toBe(true)
    for (const change of [
      { format: 'csv' },
      { format: 'html' },
      { currency: 'JPY' },
      { month: '2026-13' },
      { path: '/tmp/x.pdf' },
    ]) {
      expect(
        schemas.exportSave.safeParse({ ...valid, ...change }).success,
      ).toBe(false)
    }
  })
})
