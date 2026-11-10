// Which columns hold what, and the rows read through it. Every value is
// checked here, so a row either becomes a transaction or names its problem.
import type { AmountColumns, Mapping, RowError } from '../../shared/imports'
import { DESCRIPTION_MAX } from '../../shared/ledger'
import type { Row } from './csv'
import { parseBankAmount, parseDate } from './values'

interface ParsedRow {
  line: number
  date: string
  cents: number
  description: string
}

/**
 * Bidirectional controls, which can reorder how text around them reads,
 * and zero-width spaces, word joiners and byte order marks, which hide
 * differences between texts. Zero-width joiners and non-joiners stay:
 * scripts and emoji need them.
 */
const INVISIBLE =
  /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g

/**
 * Text as stored: bidirectional controls and zero-width spaces are dropped,
 * control characters become spaces, runs of space become one, and the
 * result is in composed form like every name in the ledger.
 */
export function cleanText(text: string): string {
  return text
    .replace(INVISIBLE, '')
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
