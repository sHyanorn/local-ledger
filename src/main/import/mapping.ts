// Which columns hold what, and the rows read through it. Every value is
// checked here, so a row either becomes a transaction or names its problem.
import type { AmountColumns, Mapping, RowError } from '../../shared/imports'
import { DESCRIPTION_MAX } from '../../shared/ledger'
import { cleanText } from '../clean-text'
import { usualWidth, width, type Row } from './csv'
import { parseBankAmount, parseDate } from './values'

interface ParsedRow {
  line: number
  date: string
  cents: number
  description: string
}

function amountOf(
  cells: readonly string[],
  amount: AmountColumns,
): { cents: number } | { value: string } {
  if (amount.kind === 'signed') {
    const value = cells[amount.column] ?? ''
    const cents = parseBankAmount(value)
    if (cents === null) return { value }
    return { cents: amount.negate && cents !== 0 ? -cents : cents }
  }
  const debitText = (cells[amount.debit] ?? '').trim()
  const creditText = (cells[amount.credit] ?? '').trim()
  const debit = debitText === '' ? 0 : parseBankAmount(debitText)
  const credit = creditText === '' ? 0 : parseBankAmount(creditText)
  if (debit === null || debit < 0) return { value: debitText }
  if (credit === null || credit < 0) return { value: creditText }
  // Exactly one side holds the amount; a zero on the other side is allowed.
  if (debitText === '' && creditText === '') return { value: '' }
  if (debit !== 0 && credit !== 0)
    return { value: `${debitText} / ${creditText}` }
  return { cents: credit - debit }
}

/**
 * How many cells a row of the file has: as many as its header, which names
 * every column the export writes, or else as most rows have. A row with a
 * value past them was split where a cell held the delimiter, most often an
 * amount's unquoted thousands separator in a comma-separated file (D024),
 * and every cell after the split has moved: read by position, -1,200.00
 * would be -1.00.
 */
function columnsOf(rows: readonly Row[], header: boolean): number {
  if (header) return rows[0]?.cells.length ?? 0
  return usualWidth(rows.map((row) => row.cells.length)).width
}

const amountColumns = (amount: AmountColumns) =>
  amount.kind === 'signed' ? [amount.column] : [amount.debit, amount.credit]

/** The amount's cells and the cells the split added, as a comma-separated file wrote them. */
function splitAmount(
  cells: readonly string[],
  amount: AmountColumns,
  extra: number,
): string {
  const columns = amountColumns(amount)
  return cells
    .slice(Math.min(...columns), Math.max(...columns) + extra + 1)
    .join(',')
}

/**
 * An amount a comma-separated file split at its thousands separators,
 * rejoined: "-1" and "200.00" are "-1,200.00". The row need be no wider than
 * the others, since an empty last cell, or one a shortened row lacks, takes
 * up the shift. A zero beside an amount, as on the unused side of debit and
 * credit columns, is not one.
 */
function rejoinedAmount(
  cells: readonly string[],
  amount: AmountColumns,
): string | null {
  for (const column of amountColumns(amount)) {
    let text = cells[column] ?? ''
    if (parseBankAmount(text) === 0) continue
    let next = column + 1
    while (
      next < cells.length &&
      parseBankAmount(`${text},${cells[next]}`) !== null
    ) {
      text = `${text},${cells[next++]}`
    }
    if (next > column + 1) return text
  }
  return null
}

/**
 * The rows read through the mapping, and the rows that could not be; the
 * delimiter is the file's.
 */
export function applyMapping(
  rows: readonly Row[],
  mapping: Mapping,
  delimiter: string,
): { rows: ParsedRow[]; errors: RowError[] } {
  const parsed: ParsedRow[] = []
  const errors: RowError[] = []
  const columns = columnsOf(rows, mapping.header)
  for (const { line, cells } of mapping.header ? rows.slice(1) : rows) {
    const dateText = cells[mapping.date] ?? ''
    const date = parseDate(dateText, mapping.dateOrder)
    if (date === null) {
      errors.push({ line, problem: 'date', value: dateText })
      continue
    }
    const extra = width(cells) - columns
    const split =
      extra > 0
        ? splitAmount(cells, mapping.amount, extra)
        : delimiter === ','
          ? rejoinedAmount(cells, mapping.amount)
          : null
    const amount =
      split === null ? amountOf(cells, mapping.amount) : { value: split }
    if ('value' in amount) {
      errors.push({ line, problem: 'amount', value: amount.value })
      continue
    }
    const description = cleanText(
      mapping.description
        .map((column) => cells[column] ?? '')
        .find((cell) => cleanText(cell) !== '') ?? '',
    )
    if (description === '') {
      errors.push({ line, problem: 'description', value: '' })
      continue
    }
    if (description.length > DESCRIPTION_MAX) {
      errors.push({
        line,
        problem: 'description-too-long',
        value: `${description.slice(0, 40)}…`,
      })
      continue
    }
    parsed.push({ line, date, cents: amount.cents, description })
  }
  return { rows: parsed, errors }
}
