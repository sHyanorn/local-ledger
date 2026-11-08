// Which columns hold what, and the rows read through it. Every value is
// checked here, so a row either becomes a transaction or names its problem.
import { DESCRIPTION_MAX } from '../../shared/ledger'
import type { Row } from './csv'
import { parseBankAmount, parseDate, type DateOrder } from './values'

export type AmountColumns =
  /** One column, money out negative; `negate` for files that write it positive. */
  | { kind: 'signed'; column: number; negate: boolean }
  /** Money out and money in in separate columns, both written positive. */
  | { kind: 'split'; debit: number; credit: number }

export interface Mapping {
  /** The first row names the columns. */
  header: boolean
  date: number
  dateOrder: DateOrder
  /** The first of these columns that is not empty. */
  description: number[]
  amount: AmountColumns
}

export interface ParsedRow {
  line: number
  date: string
  cents: number
  description: string
}

export type RowProblem =
  'date' | 'amount' | 'description' | 'description-too-long'
export interface RowError {
  line: number
  problem: RowProblem
  /** The cell at fault, shown to the user and never logged. */
  value: string
}

/**
 * Text as stored: control characters become spaces, runs of space become
 * one, and the result is in composed form like every name in the ledger.
 */
export function cleanText(text: string): string {
  return text
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .normalize('NFC')
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

/** The rows read through the mapping, and the rows that could not be. */
export function applyMapping(
  rows: readonly Row[],
  mapping: Mapping,
): { rows: ParsedRow[]; errors: RowError[] } {
  const parsed: ParsedRow[] = []
  const errors: RowError[] = []
  for (const { line, cells } of mapping.header ? rows.slice(1) : rows) {
    const dateText = cells[mapping.date] ?? ''
    const date = parseDate(dateText, mapping.dateOrder)
    if (date === null) {
      errors.push({ line, problem: 'date', value: dateText })
      continue
    }
    const amount = amountOf(cells, mapping.amount)
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
