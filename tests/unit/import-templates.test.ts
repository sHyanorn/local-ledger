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
  return { table, layout, ...applyMapping(table.rows, layout.mapping) }
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
