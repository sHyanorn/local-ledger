import { describe, expect, it } from 'vitest'
import {
  FileError,
  MAX_COLUMNS,
  MAX_FILE_BYTES,
  MAX_RECORD,
  MAX_ROWS,
  joinOverflow,
  readTable,
} from '../../src/main/import/csv'
import { decode } from '../../src/main/import/decode'
import { applyMapping, cleanText } from '../../src/main/import/mapping'
import type { Mapping } from '../../src/shared/imports'
import {
  dateOrders,
  parseBankAmount,
  parseDate,
} from '../../src/main/import/values'

const bytes = (text: string) => new TextEncoder().encode(text)

function utf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2)
  const view = new DataView(out.buffer)
  view.setUint16(0, 0xfeff, littleEndian)
  for (let i = 0; i < text.length; i++) {
    view.setUint16(2 + i * 2, text.charCodeAt(i), littleEndian)
  }
  return out
}

const fileProblem = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    if (error instanceof FileError) return error.code
    throw error
  }
  return null
}

describe('decode', () => {
  it('reads UTF-8 and drops its byte order mark', () => {
    expect(decode(bytes('﻿Café'))).toEqual({
      text: 'Café',
      encoding: 'utf-8',
    })
    expect(decode(bytes('Café'))).toEqual({ text: 'Café', encoding: 'utf-8' })
  })

  it('follows a UTF-16 byte order mark either way round', () => {
    expect(decode(utf16('Fake Café', true))).toEqual({
      text: 'Fake Café',
      encoding: 'utf-16le',
    })
    expect(decode(utf16('Fake Café', false))).toEqual({
      text: 'Fake Café',
      encoding: 'utf-16be',
    })
  })

  it('falls back to Windows-1252 when the bytes are not UTF-8', () => {
    // "Café" and a curly quote as Windows-1252 bytes.
    const legacy = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x92])
    expect(decode(legacy)).toEqual({
      text: 'Café ’',
      encoding: 'windows-1252',
    })
  })

  it('recognizes UTF-16 without a byte order mark', () => {
    const le = utf16('a,b\n', true).subarray(2)
    const be = utf16('a,b\n', false).subarray(2)
    expect(decode(le)).toEqual({ text: 'a,b\n', encoding: 'utf-16le' })
    expect(decode(be)).toEqual({ text: 'a,b\n', encoding: 'utf-16be' })
    // A character with a zero low byte among ASCII text.
    const mixed = utf16(
      `${'Fake Shop,1.00\n'.repeat(20)}\u0100\u3000\n`,
      true,
    ).subarray(2)
    expect(decode(mixed).encoding).toBe('utf-16le')
    expect(decode(new TextEncoder().encode('Fake Café,1.00\n')).encoding).toBe(
      'utf-8',
    )
  })

  it('uses the encoding it is given', () => {
    expect(decode(bytes('Café'), 'windows-1252').text).toBe('CafÃ©')
  })
})

describe('readTable', () => {
  it('splits quoted fields with commas, quotes and line breaks', () => {
    const table = readTable(
      bytes(
        '01/02/2026,"-5.00","Fake ""Corner"" Shop, Town",\r\n' +
          '02/02/2026,"+10.00","Two\nlines",\r\n',
      ),
    )
    expect(table.delimiter).toBe(',')
    expect(table.rows).toEqual([
      {
        line: 1,
        cells: ['01/02/2026', '-5.00', 'Fake "Corner" Shop, Town', ''],
      },
      { line: 3, cells: ['02/02/2026', '+10.00', 'Two\nlines', ''] },
    ])
  })

  it('skips blank lines and rows of empty cells, and reads a last line without a break', () => {
    const table = readTable(bytes('a,b\n\n,\nc,d'))
    expect(table.rows.map((row) => row.cells)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('tolerates a stray quote inside an unquoted field', () => {
    const table = readTable(bytes('01/02/2026,-5.00,Fake 12" Pizza\n'))
    expect(table.rows[0]?.cells[2]).toBe('Fake 12" Pizza')
  })

  it.each([
    ['semicolons', ';'],
    ['tabs', '\t'],
  ])('detects %s between fields', (_, delimiter) => {
    const text = ['Date', 'Amount', 'Description, with comma']
      .join(delimiter)
      .concat('\n', ['01/02/2026', '-5,00', 'Fake Shop'].join(delimiter))
    const table = readTable(bytes(text))
    expect(table.delimiter).toBe(delimiter)
    expect(table.rows[0]?.cells).toEqual([
      'Date',
      'Amount',
      'Description, with comma',
    ])
  })

  it('keeps commas when a description holds a semicolon', () => {
    const table = readTable(bytes('01/02/2026,-5.00,Fake; Shop\n'))
    expect(table.delimiter).toBe(',')
  })

  it('reads a short tab-separated file whose amounts have thousands commas', () => {
    const table = readTable(
      bytes(
        'Date\tAmount\tDescription\n01/02/2026\t-1,234,567.00\tFake, Shop\n',
      ),
    )
    expect(table.delimiter).toBe('\t')
    expect(table.rows[1]?.cells).toEqual([
      '01/02/2026',
      '-1,234,567.00',
      'Fake, Shop',
    ])
  })

  it('reports the encoding it read', () => {
    expect(readTable(utf16('a,b\n', true)).encoding).toBe('utf-16le')
  })

  it('refuses files over the limits', () => {
    expect(
      fileProblem(() => readTable(new Uint8Array(MAX_FILE_BYTES + 1))),
    ).toBe('too-large')
    expect(
      fileProblem(() => readTable(bytes('a,b\n'.repeat(MAX_ROWS + 1)))),
    ).toBe('too-many-rows')
    expect(fileProblem(() => readTable(bytes('a,b\n'.repeat(MAX_ROWS))))).toBe(
      null,
    )
    expect(
      fileProblem(() => readTable(bytes(','.repeat(MAX_COLUMNS) + 'x\n'))),
    ).toBe('too-many-columns')
    expect(
      fileProblem(() =>
        readTable(bytes(`a,"${'x'.repeat(MAX_RECORD + 1)}"\n`)),
      ),
    ).toBe('record-too-long')
  })

  it('refuses a file with no rows, and one that is not CSV', () => {
    expect(fileProblem(() => readTable(bytes('\n\n')))).toBe('empty')
    expect(fileProblem(() => readTable(bytes('a,"b\n')))).toBe('not-csv')
  })
})

describe('parseDate', () => {
  it.each([
    ['29/05/2026', 'dmy', '2026-05-29'],
    ['5/1/2026', 'dmy', '2026-01-05'],
    ['05-01-26', 'dmy', '2026-01-05'],
    ['05.01.2026', 'dmy', '2026-01-05'],
    ['05/29/2026', 'mdy', '2026-05-29'],
    ['2026-05-29', 'ymd', '2026-05-29'],
    ['20260529', 'ymd', '2026-05-29'],
    ['29052026', 'dmy', '2026-05-29'],
    ['29 May 26', 'dmy', '2026-05-29'],
    ['08 July 26', 'dmy', '2026-07-08'],
    ['8 Sept 2026', 'mdy', '2026-09-08'],
    ['May 29, 2026', 'dmy', '2026-05-29'],
    ['29/05/2026 14:03', 'dmy', '2026-05-29'],
    ['29/05/2026 2:03 PM', 'dmy', '2026-05-29'],
    ['31/12/99', 'dmy', '1999-12-31'],
  ] as const)('reads %s (%s) as %s', (text, order, iso) => {
    expect(parseDate(text, order)).toBe(iso)
  })

  it.each([
    ['31/02/2026', 'dmy'],
    ['29/05/2026', 'mdy'],
    ['26-05-29', 'ymd'],
    ['29 Mai 26', 'dmy'],
    ['29/05', 'dmy'],
    ['', 'dmy'],
    ['=29/05/2026', 'dmy'],
    ['29/05/1899', 'dmy'],
    ['29/05/202', 'dmy'],
    ['29/012/2026', 'dmy'],
    ['012/29/2026', 'mdy'],
  ] as const)('refuses %s (%s)', (text, order) => {
    expect(parseDate(text, order)).toBeNull()
  })
})

describe('dateOrders', () => {
  it('keeps only the orders every value fits, day first first', () => {
    expect(dateOrders(['01/02/2026', '13/02/2026'])).toEqual(['dmy'])
    expect(dateOrders(['01/02/2026', '02/13/2026'])).toEqual(['mdy'])
    expect(dateOrders(['01/02/2026', '03/04/2026'])).toEqual(['dmy', 'mdy'])
    expect(dateOrders(['2026-02-01', ''])).toEqual(['ymd'])
    expect(dateOrders(['someday'])).toEqual([])
    expect(dateOrders([''])).toEqual([])
  })
})

describe('parseBankAmount', () => {
  it.each([
    ['-15.26', -1526],
    ['+2000.00', 200000],
    ['2,000.00', 200000],
    ['$5', 500],
    ['-$5.10', -510],
    ['$-5.10', -510],
    ['AUD 7.25', 725],
    ['(12.50)', -1250],
    ['($12.50)', -1250],
    ['12.50 CR', 1250],
    ['12.50 DR', -1250],
    ['−12.50', -1250],
    ['0.00', 0],
  ])('reads %s as %i cents', (text, cents) => {
    expect(parseBankAmount(text)).toBe(cents)
  })

  it.each([
    '',
    '-',
    '=1+1',
    '1.234',
    '12,50',
    '(-12.50)',
    '-12.50 CR',
    '+12.50 DR',
    '@SUM(A1)',
    'five',
  ])('refuses %j', (text) => {
    expect(parseBankAmount(text)).toBeNull()
  })
})

describe('cleanText', () => {
  it('turns control characters into single spaces and composes', () => {
    expect(cleanText('  Fake\tCafé\r\nShop\u0000 ')).toBe('Fake Café Shop')
  })

  it('drops invisible format characters', () => {
    expect(cleanText('Fake\u202eShop\u200b Cafe\u2066')).toBe('FakeShop Cafe')
    // Joiners and soft hyphens carry meaning; they stay.
    expect(cleanText('\u{1F469}\u200d\u{1F4BB} Fake\u00adShop\u200c')).toBe(
      '\u{1F469}\u200d\u{1F4BB} Fake\u00adShop\u200c',
    )
  })

  it('keeps text that a spreadsheet would read as a formula', () => {
    expect(cleanText('=HYPERLINK("x")')).toBe('=HYPERLINK("x")')
  })
})

describe('applyMapping', () => {
  const signed: Mapping = {
    header: false,
    date: 0,
    dateOrder: 'dmy',
    description: [2],
    amount: { kind: 'signed', column: 1, negate: false },
  }
  const row = (line: number, ...cells: string[]) => ({ line, cells })

  it('reads dates, signed amounts and descriptions', () => {
    expect(
      applyMapping(
        [
          row(1, '02/03/2026', '-4.50', 'Fake Bakery'),
          row(2, '03/03/2026', '+100', 'Fake Pay'),
        ],
        signed,
      ),
    ).toEqual({
      rows: [
        {
          line: 1,
          date: '2026-03-02',
          cents: -450,
          description: 'Fake Bakery',
        },
        { line: 2, date: '2026-03-03', cents: 10000, description: 'Fake Pay' },
      ],
      errors: [],
    })
  })

  it('skips the header, and takes the first description column with text', () => {
    const result = applyMapping(
      [
        row(1, 'Date', 'Amount', 'Details', 'Type'),
        row(2, '02/03/2026', '-1', 'Fake Kiosk', 'EFTPOS'),
        row(3, '02/03/2026', '-1', ' ', 'EFTPOS'),
      ],
      { ...signed, header: true, description: [2, 3] },
    )
    expect(result.rows.map((parsed) => parsed.description)).toEqual([
      'Fake Kiosk',
      'EFTPOS',
    ])
  })

  it('flips the sign for files that write money out as positive', () => {
    const result = applyMapping([row(1, '02/03/2026', '4.50', 'Fake Card')], {
      ...signed,
      amount: { kind: 'signed', column: 1, negate: true },
    })
    expect(result.rows[0]?.cents).toBe(-450)
  })

  it('reads separate debit and credit columns', () => {
    const split: Mapping = {
      ...signed,
      description: [1],
      amount: { kind: 'split', debit: 2, credit: 3 },
    }
    const result = applyMapping(
      [
        row(1, '02/03/2026', 'Fake Out', '4.50', ''),
        row(2, '02/03/2026', 'Fake In', '', '9.00'),
        row(3, '02/03/2026', 'Fake Zero Debit', '0.00', '9.00'),
        row(4, '02/03/2026', 'Fake Both', '1.00', '9.00'),
        row(5, '02/03/2026', 'Fake Neither', '', ''),
        row(6, '02/03/2026', 'Fake Negative', '-1.00', ''),
      ],
      split,
    )
    expect(result.rows.map((parsed) => parsed.cents)).toEqual([-450, 900, 900])
    expect(result.errors).toEqual([
      { line: 4, problem: 'amount', value: '1.00 / 9.00' },
      { line: 5, problem: 'amount', value: '' },
      { line: 6, problem: 'amount', value: '-1.00' },
    ])
  })

  it('names the problem with each row it cannot read', () => {
    const result = applyMapping(
      [
        row(3, '31/02/2026', '-1', 'Fake A'),
        row(4, '01/02/2026', '=1+1', 'Fake B'),
        row(5, '01/02/2026', '-1', '  '),
        row(6, '01/02/2026', '-1', 'x'.repeat(501)),
        row(7, '01/02/2026'),
      ],
      signed,
    )
    expect(result.rows).toEqual([])
    expect(result.errors).toEqual([
      { line: 3, problem: 'date', value: '31/02/2026' },
      { line: 4, problem: 'amount', value: '=1+1' },
      { line: 5, problem: 'description', value: '' },
      { line: 6, problem: 'description-too-long', value: `${'x'.repeat(40)}…` },
      { line: 7, problem: 'amount', value: '' },
    ])
  })
})

describe('joinOverflow', () => {
  const row = (line: number, ...cells: string[]) => ({ line, cells })
  const rows = [
    row(1, 'Date', 'Description', 'Amount'),
    row(2, '01/02/2026', 'Fake Shop', '-5,00'),
    row(3, '02/02/2026', 'Fake Cafe', 'with a semicolon', '-3,00'),
    row(4, '03/02/2026', 'Fake Bar', '-2,00'),
  ]

  it('joins a semicolon-split description back together', () => {
    expect(joinOverflow(rows, ';', 1)[2]).toEqual(
      row(3, '02/02/2026', 'Fake Cafe; with a semicolon', '-3,00'),
    )
    expect(joinOverflow(rows, '\t', 1)[2]?.cells[1]).toBe(
      'Fake Cafe with a semicolon',
    )
  })

  it('leaves comma files, rows of the usual width, and a description past it alone', () => {
    expect(joinOverflow(rows, ',', 1)).toEqual(rows)
    expect(joinOverflow(rows, ';', 1)[1]).toBe(rows[1])
    expect(joinOverflow(rows, ';', 3)).toEqual(rows)
    expect(joinOverflow(rows, ';', undefined)).toEqual(rows)
  })
})
