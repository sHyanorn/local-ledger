import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readTable, type Row } from '../../src/main/import/csv'
import { applyMapping } from '../../src/main/import/mapping'
import { detectLayout } from '../../src/main/import/templates'

const sample = (name: string) =>
  readTable(readFileSync(join(__dirname, '../fixtures/csv', name)))

function read(name: string) {
  const table = sample(name)
  const layout = detectLayout(table.rows)
  if (!layout) throw new Error(`no layout for ${name}`)
  return {
    table,
    layout,
    ...applyMapping(table.rows, layout.mapping, table.delimiter),
  }
}

const rows = (...lines: string[][]): Row[] =>
  lines.map((cells, index) => ({ line: index + 1, cells }))

describe('bank templates', () => {
  it('reads CommBank', () => {
    const { layout, rows: parsed, errors } = read('commbank.csv')
    expect(layout.template).toBe('commbank')
    expect(errors).toEqual([])
    expect(parsed.map(({ date, cents }) => [date, cents])).toEqual([
      ['2026-05-29', -1526],
      ['2026-05-28', 200000],
      ['2026-05-28', -450],
      ['2026-05-27', -125000],
      ['2026-05-03', -450],
      ['2026-05-03', -450],
    ])
    expect(parsed[2]?.description).toBe(
      'FAKE CAFE, "THE CORNER" NEWTOWN Card xx0000 Value Date: 26/05/2026',
    )
  })

  it('reads CommBank with a byte order mark and CRLF', () => {
    const { table, layout, rows: parsed } = read('commbank-bom-crlf.csv')
    expect(table.encoding).toBe('utf-8')
    expect(layout.template).toBe('commbank')
    expect(parsed.map((row) => row.description)).toEqual([
      'FAKE MARKET STALL SYDNEY NS AUS',
      'Salary FAKE EMPLOYER PTY LTD',
    ])
  })

  it('reads NAB, with its short rows', () => {
    const { layout, rows: parsed, errors } = read('nab.csv')
    expect(layout.template).toBe('nab')
    expect(layout.mapping.header).toBe(true)
    expect(errors).toEqual([])
    expect(
      parsed.map(({ line, date, cents, description }) => [
        line,
        date,
        cents,
        description,
      ]),
    ).toEqual([
      [2, '2026-05-29', -1526, 'FAKE MARKET STALL SYDNEY'],
      [3, '2026-05-28', 200000, 'SALARY FAKE EMPLOYER'],
      [4, '2026-05-27', -3000, 'ONLINE TRANSFER TO FAKE SAVINGS'],
      [5, '2026-05-26', -450, 'FAKE CAFE, NEWTOWN'],
    ])
  })

  it('reads the 2022 NAB layout with full month names', () => {
    const { layout, rows: parsed, errors } = read('nab-2022.csv')
    expect(layout.template).toBe('nab')
    expect(errors).toEqual([])
    expect(parsed.map(({ date, cents }) => [date, cents])).toEqual([
      ['2026-07-08', -6210],
      ['2026-07-01', 10000],
    ])
  })

  it('takes the NAB merchant, then the type, when the details are empty', () => {
    const header =
      'Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name'.split(
        ',',
      )
    const layout = detectLayout(
      rows(
        header,
        ['29 May 26', '-1', '0', '', 'FEE', '', '0', '', 'Fake Bank'],
        ['29 May 26', '-1', '0', '', 'FEE', '', '0'],
      ),
    )
    expect(layout?.template).toBe('nab')
    const parsed = applyMapping(
      rows(
        header,
        ['29 May 26', '-1', '0', '', 'FEE', '', '0', '', 'Fake Bank'],
        ['29 May 26', '-1', '0', '', 'FEE', '', '0'],
      ),
      layout!.mapping,
      ',',
    )
    expect(parsed.rows.map((row) => row.description)).toEqual([
      'Fake Bank',
      'FEE',
    ])
  })

  it.each(['anz.csv', 'anz-extended.csv'])('reads ANZ (%s)', (name) => {
    const { layout, rows: parsed, errors } = read(name)
    expect(layout.template).toBe('anz')
    expect(errors).toEqual([])
    expect(parsed[0]).toEqual({
      line: 1,
      date: '2026-05-29',
      cents: -1526,
      description: 'FAKE MARKET STALL SYDNEY AU',
    })
    expect(parsed[1]?.cents).toBe(200000)
  })

  it('reads Westpac, with the account column', () => {
    const { layout, rows: parsed, errors } = read('westpac.csv')
    expect(layout.template).toBe('westpac')
    expect(layout.accountColumn).toBe(0)
    expect(layout.dateOrders).toEqual(['dmy'])
    expect(errors).toEqual([])
    expect(
      parsed.map(({ cents, description }) => [cents, description]),
    ).toEqual([
      [-1526, 'FAKE MARKET STALL SYDNEY AU'],
      [200000, 'DEPOSIT FAKE EMPLOYER PTY LTD'],
      [-450, 'FAKE CAFE NEWTOWN AU'],
      [10000, 'PAYMENT RECEIVED, THANK YOU'],
    ])
  })

  it('never reads a bank category column into the description', () => {
    for (const name of ['nab.csv', 'westpac.csv']) {
      const { layout } = read(name)
      expect(layout.mapping.description).not.toContain(
        name === 'nab.csv' ? 7 : 6,
      )
    }
  })
})

describe('guessed layouts', () => {
  it('guesses another bank’s columns from the header and values', () => {
    const { layout, rows: parsed, errors } = read('other-bank.csv')
    expect(layout).toMatchObject({
      template: null,
      mapping: {
        header: true,
        date: 0,
        dateOrder: 'ymd',
        description: [1],
        amount: { kind: 'split', debit: 2, credit: 3 },
      },
    })
    expect(errors).toEqual([])
    expect(parsed.map((row) => row.cents)).toEqual([-1526, 200000])
  })

  it('takes the first amount column, skipping a balance, without a header', () => {
    const layout = detectLayout(
      rows(
        ['Fake Shop', '1/2/2026', '-5.00', '100.00'],
        ['Fake Pay', '3/2/2026', '20.00', '120.00'],
      ),
    )
    expect(layout?.mapping).toMatchObject({
      header: false,
      date: 1,
      description: [0],
      amount: { kind: 'signed', column: 2 },
    })
    expect(layout?.dateOrders).toEqual(['dmy', 'mdy'])
  })

  it('skips a column the header names as the balance', () => {
    const layout = detectLayout(
      rows(
        ['Date', 'Balance', 'Amount', 'Memo'],
        ['2026-02-01', '100.00', '-5.00', 'Fake Shop'],
      ),
    )
    expect(layout?.mapping.amount).toEqual({
      kind: 'signed',
      column: 2,
      negate: false,
    })
  })

  it('gives up without a date, an amount or a description', () => {
    expect(detectLayout(rows(['a', 'b'], ['c', 'd']))).toBeNull()
    expect(detectLayout(rows(['1/2/2026', 'Fake Shop']))).toBeNull()
    expect(detectLayout(rows(['1/2/2026', '-5.00']))).toBeNull()
    expect(detectLayout(rows(['Date', 'Amount']))).toBeNull()
  })

  it('does not take a four-column file with a text fourth column for CommBank', () => {
    const layout = detectLayout(
      rows(['01/02/2026', '-5.00', 'Fake Shop', 'Fake Note']),
    )
    expect(layout?.template).toBeNull()
  })

  it('still finds the layout and date order past one bad row', () => {
    const layout = detectLayout(
      rows(
        ['13/05/2026', '-1.00', 'Fake A', '1.00'],
        ['31/02/2026', '-1.00', 'Fake B', '1.00'],
        ['14/05/2026', '-1.00', 'Fake C', '1.00'],
        ['Closing balance', '', '', '1.00'],
      ),
    )
    // Two bad rows of four is past the tolerance.
    expect(layout).toBeNull()
    const tidy = detectLayout(
      rows(
        ['13/05/2026', '-1.00', 'Fake A', '1.00'],
        ['31/02/2026', '-1.00', 'Fake B', '1.00'],
        ['14/05/2026', '-1.00', 'Fake C', '1.00'],
      ),
    )
    expect(tidy?.template).toBe('commbank')
    expect(tidy?.dateOrders).toEqual(['dmy'])
  })
})

describe('date order', () => {
  const file = (dates: string[]) =>
    rows(...dates.map((date, index) => [date, '-1.00', `Fake ${index}`]))
  const early = Array.from(
    { length: 60 },
    (_, index) => `0${(index % 9) + 1}/0${(index % 3) + 1}/2026`,
  )

  it('takes the order that reads the most dates, past the first rows', () => {
    // Sixty dates fit either order; the two after them only month first.
    const layout = detectLayout(file([...early, '05/13/2026', '05/14/2026']))
    expect(layout?.mapping.dateOrder).toBe('mdy')
    expect(layout?.dateOrders).toEqual(['mdy'])
  })

  it('lists one order when a month name settles it', () => {
    expect(detectLayout(file(['29 May 26', '01 Jun 26']))?.dateOrders).toEqual([
      'dmy',
    ])
    expect(read('nab.csv').layout.dateOrders).toEqual(['dmy'])
  })

  it('lists every order that reads them all, day first first', () => {
    const layout = detectLayout(file(early))
    expect(layout?.mapping.dateOrder).toBe('dmy')
    expect(layout?.dateOrders).toEqual(['dmy', 'mdy'])
  })
})

describe('layouts as public sample files write them', () => {
  it('takes a header added to a CommBank or ANZ file as a header', () => {
    const commbank = detectLayout(
      rows(
        ['Date', 'Amount', 'Description', 'Balance'],
        ['29/05/2026', '-15.26', 'Fake Shop', '+0.00'],
        ['28/05/2026', '+2500.00', 'Fake Pay', '+15.26'],
      ),
    )
    expect(commbank).toMatchObject({
      template: 'commbank',
      mapping: { header: true },
    })
    const anz = detectLayout(
      rows(
        ['Date', 'Amount', 'Description'],
        ['29/05/2026', '-15.26', 'Fake Shop'],
      ),
    )
    expect(anz).toMatchObject({ template: 'anz', mapping: { header: true } })
    expect(
      applyMapping(
        rows(
          ['Date', 'Amount', 'Description'],
          ['29/05/2026', '-15.26', 'Fake Shop'],
        ),
        anz!.mapping,
        ',',
      ).errors,
    ).toEqual([])
  })

  it('reads NAB with spaced fields, whole amounts and one decimal', () => {
    const table = readTable(
      new TextEncoder().encode(
        'Date,Amount,Account Number, ,Transaction Type,Transaction Details,Balance,Category,Merchant Name\n' +
          '29 Mar 24, 12.5 ,Card ending 0000, ,CREDIT, FAKE REFUND ,-1200,Refunds,\n' +
          '30 Mar 24,-1200,Card ending 0000, ,CARD PURCHASE,FAKE STORE,-2400,Shopping,Fake Store\n',
      ),
    )
    const layout = detectLayout(table.rows)
    expect(layout?.template).toBe('nab')
    expect(applyMapping(table.rows, layout!.mapping, table.delimiter)).toEqual({
      rows: [
        {
          line: 2,
          date: '2024-03-29',
          cents: 1250,
          description: 'FAKE REFUND',
        },
        {
          line: 3,
          date: '2024-03-30',
          cents: -120000,
          description: 'FAKE STORE',
        },
      ],
      errors: [],
    })
  })
})

describe('tolerance of export variations', () => {
  type Variant = {
    name: string
    cell?: (value: string, column: number, template: string) => string
    quote?: 'all' | 'needed'
    eol?: '\n' | '\r\n'
    bom?: boolean
    finalBreak?: boolean
  }
  const DATE_COLUMN: Record<string, number> = {
    commbank: 0,
    nab: 0,
    anz: 0,
    westpac: 1,
  }
  const AMOUNT_COLUMNS: Record<string, number[]> = {
    commbank: [1, 3],
    nab: [1, 6],
    anz: [1],
    westpac: [3, 4, 5],
  }
  const thousands = (value: string) =>
    value.replace(
      /^([+-]?)(\d+)(\.\d+)?$/,
      (_, sign: string, whole: string, fraction = '') =>
        `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`,
    )
  const variants: Variant[] = [
    { name: 'every field quoted', quote: 'all' },
    { name: 'only needed quotes', quote: 'needed' },
    { name: 'CRLF and a byte order mark', eol: '\r\n', bom: true },
    { name: 'no final line break', finalBreak: false },
    {
      name: 'two-digit years',
      cell: (value, column, template) =>
        column === DATE_COLUMN[template]
          ? value.replace(/\/20(\d\d)$/, '/$1').replace(/ 20(\d\d)$/, ' $1')
          : value,
    },
    {
      name: 'four-digit years',
      cell: (value, column, template) =>
        column === DATE_COLUMN[template]
          ? value.replace(/^(\d\d? [A-Za-z]+) (\d\d)$/, '$1 20$2')
          : value,
    },
    {
      name: 'thousands separators',
      cell: (value, column, template) =>
        AMOUNT_COLUMNS[template]?.includes(column)
          ? thousands(value.replaceAll(',', ''))
          : value,
    },
    {
      name: 'no plus sign on credits',
      cell: (value, column, template) =>
        AMOUNT_COLUMNS[template]?.includes(column)
          ? value.replace(/^\+/, '')
          : value,
    },
  ]
  const samples = [
    'commbank.csv',
    'nab.csv',
    'nab-2022.csv',
    'anz.csv',
    'anz-extended.csv',
    'westpac.csv',
  ]

  function write(rows: Row[], template: string, variant: Variant): Uint8Array {
    const eol = variant.eol ?? '\n'
    const lines = rows.map((row) =>
      row.cells
        .map((cell, column) => {
          const value = variant.cell
            ? variant.cell(cell, column, template)
            : cell
          const needed = /[",\r\n]/.test(value)
          return variant.quote === 'all' || needed
            ? `"${value.replaceAll('"', '""')}"`
            : value
        })
        .join(','),
    )
    const text = lines.join(eol) + (variant.finalBreak === false ? '' : eol)
    const bytes = new TextEncoder().encode(text)
    return variant.bom ? new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]) : bytes
  }

  for (const name of samples) {
    const base = read(name)
    const expected = base.rows.map(({ date, cents, description }) => ({
      date,
      cents,
      description,
    }))
    it.each(variants)(`${name} with $name`, (variant) => {
      const template = base.layout.template!
      const table = readTable(write(base.table.rows, template, variant))
      const layout = detectLayout(table.rows)
      expect(layout?.template).toBe(template)
      const parsed = applyMapping(table.rows, layout!.mapping, table.delimiter)
      expect(parsed.errors).toEqual([])
      expect(
        parsed.rows.map(({ date, cents, description }) => ({
          date,
          cents,
          description,
        })),
      ).toEqual(expected)
    })
  }
})
