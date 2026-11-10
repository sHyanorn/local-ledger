// The layouts of the four banks' CSV exports, and a guess at any other file.
// The banks do not publish their layouts; these follow open-source parsers
// written against real exports (D024). A bank's own category column is never
// read: the ledger's categories are the user's.
import {
  DATE_ORDERS,
  type DateOrder,
  type Mapping,
  type TemplateId,
} from '../../shared/imports'
import type { Row } from './csv'
import { dateOrders, parseBankAmount, parseDate } from './values'

export interface Layout {
  /** The bank whose layout this is, or null for a guess. */
  template: TemplateId | null
  mapping: Mapping
  /** The column naming the bank account, when one file holds several. */
  accountColumn: number | null
  /** The date orders the dates fit; more than one means the user chooses. */
  dateOrders: DateOrder[]
}

const SAMPLE = 50

/**
 * Most rows pass: all but a tenth, or all but one in a short file, so a
 * stray summary line or a mistyped date does not hide the layout.
 */
function mostly<T>(rows: readonly T[], test: (row: T) => boolean): boolean {
  const passing = rows.filter(test).length
  return passing > 0 && rows.length - passing <= Math.max(1, rows.length / 10)
}

const isAmount = (cell: string | undefined) =>
  cell !== undefined && cell.trim() !== '' && parseBankAmount(cell) !== null

const startsWith = (cells: readonly string[], names: readonly string[]) =>
  names.every((name, index) => cells[index]?.trim().toLowerCase() === name)

const NAB_HEADER = [
  'date',
  'amount',
  'account number',
  '',
  'transaction type',
  'transaction details',
  'balance',
  'category',
  'merchant name',
]
const WESTPAC_HEADER = [
  'bank account',
  'date',
  'narrative',
  'debit amount',
  'credit amount',
  'balance',
  'categories',
  'serial',
]

/**
 * Strips empty trailing cells, which some exports add; unlike the width
 * that reading uses, a cell of spaces in quotes counts as empty here too.
 */
const width = (cells: readonly string[]) => {
  let end = cells.length
  while (end > 0 && cells[end - 1]?.trim() === '') end--
  return end
}

/**
 * The layout, with the date order that reads the most of the file's dates.
 * When several read them all, as when no day is past the 12th, they are all
 * listed for the user to choose from.
 */
function layout(
  template: TemplateId | null,
  mapping: Omit<Mapping, 'dateOrder'>,
  rows: readonly Row[],
  accountColumn: number | null = null,
): Layout {
  const dates = (mapping.header ? rows.slice(1) : rows)
    .map((row) => row.cells[mapping.date] ?? '')
    .filter((date) => date.trim() !== '')
  const read = DATE_ORDERS.map(
    (order) =>
      [
        order,
        dates.filter((date) => parseDate(date, order) !== null).length,
      ] as const,
  )
  const most = Math.max(...read.map(([, count]) => count))
  const fitting = read
    .filter(([, count]) => count === most)
    .map(([order]) => order)
  // Orders that read every date alike, as a month name makes them, are one.
  const differ = (order: DateOrder) =>
    dates.some(
      (date) => parseDate(date, order) !== parseDate(date, fitting[0] ?? order),
    )
  const best = fitting.filter((order, index) => index === 0 || differ(order))
  return {
    template,
    mapping: { ...mapping, dateOrder: best[0] ?? 'dmy' },
    accountColumn,
    dateOrders: most > 0 ? best : [],
  }
}

function bankLayout(rows: readonly Row[]): Layout | null {
  const first = rows[0]?.cells ?? []
  const data = (header: boolean) => rows.slice(header ? 1 : 0, SAMPLE + 1)

  if (startsWith(first, NAB_HEADER)) {
    // Transaction Details, else Merchant Name, else Transaction Type.
    return layout(
      'nab',
      {
        header: true,
        date: 0,
        description: [5, 8, 4],
        amount: { kind: 'signed', column: 1, negate: false },
      },
      rows,
    )
  }
  if (startsWith(first, WESTPAC_HEADER)) {
    return layout(
      'westpac',
      {
        header: true,
        date: 1,
        description: [2],
        amount: { kind: 'split', debit: 3, credit: 4 },
      },
      rows,
      0,
    )
  }

  // These banks write no header, but a file someone has opened and saved
  // may have gained one: a first row with neither a date nor an amount.
  const header =
    dateOrders([first[0] ?? '']).length === 0 && !isAmount(first[1])
  const sample = data(header)
  const dated = mostly(
    sample,
    (row) =>
      dateOrders([row.cells[0] ?? '']).includes('dmy') &&
      isAmount(row.cells[1]),
  )
  if (!dated) return null
  const mapping = {
    header,
    date: 0,
    description: [2],
    amount: { kind: 'signed', column: 1, negate: false },
  } satisfies Omit<Mapping, 'dateOrder'>
  // CommBank adds a running balance; ANZ has none, and may add five more columns.
  if (
    mostly(sample, (row) => width(row.cells) === 4 && isAmount(row.cells[3]))
  ) {
    return layout('commbank', mapping, rows)
  }
  if (
    mostly(
      sample,
      (row) =>
        (row.cells.length === 3 || row.cells.length === 8) &&
        !isAmount(row.cells[3]),
    )
  ) {
    return layout('anz', mapping, rows)
  }
  return null
}

const OUT = /debit|withdrawal|money out|paid out|spent/i
const IN = /credit|deposit|money in|paid in|received/i

/** The columns of a layout no template knows, as far as they can be told. */
function guessLayout(rows: readonly Row[]): Layout | null {
  const isDate = (cell: string | undefined) =>
    cell !== undefined && dateOrders([cell]).length > 0
  const firstCells = rows[0]?.cells ?? []
  const header = !firstCells.some(isDate) && !firstCells.some(isAmount)
  const names = header ? firstCells.map((cell) => cell.toLowerCase()) : []
  const sample = rows.slice(header ? 1 : 0, SAMPLE + 1)
  if (sample.length === 0) return null
  const columns = Math.max(...sample.map((row) => row.cells.length))
  const fits = (index: number, test: (cell: string | undefined) => boolean) =>
    mostly(sample, (row) => test(row.cells[index]))
  const indexes = [...Array(columns).keys()]

  const date = indexes.find((index) => fits(index, isDate))
  if (date === undefined) return null

  const named = (pattern: RegExp) =>
    indexes.find((index) => index !== date && pattern.test(names[index] ?? ''))
  const debit = named(OUT)
  const credit = named(IN)
  let amount: Mapping['amount'] | undefined
  if (debit !== undefined && credit !== undefined && debit !== credit) {
    amount = { kind: 'split', debit, credit }
  } else {
    const column = indexes.find(
      (index) =>
        index !== date &&
        !/balance/i.test(names[index] ?? '') &&
        fits(index, isAmount),
    )
    if (column !== undefined) amount = { kind: 'signed', column, negate: false }
  }
  if (amount === undefined) return null

  const used = new Set(
    amount.kind === 'split'
      ? [date, amount.debit, amount.credit]
      : [date, amount.column],
  )
  const textLength = (index: number) =>
    sample.reduce((sum, row) => {
      const cell = row.cells[index] ?? ''
      return isAmount(cell) || isDate(cell) ? sum : sum + cell.trim().length
    }, 0)
  const description = indexes
    .filter((index) => !used.has(index))
    .sort((a, b) => textLength(b) - textLength(a))[0]
  if (description === undefined || textLength(description) === 0) return null

  return layout(
    null,
    { header, date, description: [description], amount },
    rows,
  )
}

/** The bank layout the rows are in, else a guess, else null. */
export function detectLayout(rows: readonly Row[]): Layout | null {
  return bankLayout(rows) ?? guessLayout(rows)
}
