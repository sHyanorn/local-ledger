// Dates and amounts as banks write them, read into the ledger's forms:
// YYYY-MM-DD and integer cents.
import { isIsoDate } from '../../shared/dates'
import { DATE_ORDERS, type DateOrder } from '../../shared/imports'
import { parseAmount } from '../../shared/money'

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/** Month numbers by full name, three-letter abbreviation, and "sept". */
const MONTHS = new Map<string, number>([
  ...MONTH_NAMES.map((name, index) => [name, index + 1] as const),
  ...MONTH_NAMES.map((name, index) => [name.slice(0, 3), index + 1] as const),
  ['sept', 9],
])

// A time after the date, as some exports add: "29/05/2026 14:03" or "2:03 PM".
const TIME = /\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?$/i

/**
 * A two-digit year is this century's unless that is past next year, as in
 * a statement from 1999 read in 2026.
 */
function fullYear(year: string): string {
  if (year.length === 4) return year
  const recent = 2000 + Number(year)
  return String(recent > new Date().getFullYear() + 1 ? recent - 100 : recent)
}

function iso(year: string, month: number | string, day: string): string | null {
  if (!/^\d{1,2}$/.test(day) || !/^(\d{2}|\d{4})$/.test(year)) return null
  if (typeof month === 'string' && !/^\d{1,2}$/.test(month)) return null
  const text = `${fullYear(year)}-${String(Number(month)).padStart(2, '0')}-${day.padStart(2, '0')}`
  return isIsoDate(text) ? text : null
}

/** The date as YYYY-MM-DD, or null if the text is not a date in this order. */
export function parseDate(text: string, order: DateOrder): string | null {
  const trimmed = text.trim().replace(TIME, '')
  if (/^\d{8}$/.test(trimmed)) {
    const parts =
      order === 'ymd'
        ? [trimmed.slice(0, 4), trimmed.slice(4, 6), trimmed.slice(6)]
        : [trimmed.slice(0, 2), trimmed.slice(2, 4), trimmed.slice(4)]
    return parseParts(parts, order)
  }
  const parts = trimmed.split(/[/.\- ]+|,\s*/)
  return parts.length === 3 ? parseParts(parts, order) : null
}

function parseParts(parts: string[], order: DateOrder): string | null {
  const [a = '', b = '', c = ''] = parts
  const named = parts.findIndex((part) => /^[a-z]+$/i.test(part))
  if (named !== -1) {
    // A month name settles the order: "29 May 26", "May 29 2026", "2026 May 29".
    const month = MONTHS.get((parts[named] ?? '').toLowerCase())
    if (month === undefined) return null
    if (named === 1) return a.length === 4 ? iso(a, month, c) : iso(c, month, a)
    if (named === 0) return iso(c, month, b)
    return null
  }
  if (!parts.every((part) => /^\d+$/.test(part))) return null
  switch (order) {
    case 'dmy':
      return iso(c, b, a)
    case 'mdy':
      return iso(c, a, b)
    case 'ymd':
      return a.length === 4 ? iso(a, b, c) : null
  }
}

/**
 * The orders in which every value is a date, day first first. Several mean
 * the file cannot tell, as when no day is past the 12th.
 */
export function dateOrders(values: readonly string[]): DateOrder[] {
  const filled = values.filter((value) => value.trim() !== '')
  if (filled.length === 0) return []
  return DATE_ORDERS.filter((order) =>
    filled.every((value) => parseDate(value, order) !== null),
  )
}

/**
 * Cents from an amount as a bank writes it: "-15.26", "+2,000.00", "$5",
 * "(12.50)", "12.50 CR", with a Unicode minus. Null for anything else.
 */
export function parseBankAmount(text: string): number | null {
  let value = text.trim().replace(/−/g, '-')
  let negate = false
  const parenthesized = /^\((.*)\)$/.exec(value)
  if (parenthesized) {
    value = parenthesized[1]?.trim() ?? ''
    negate = true
  }
  const marked = /^(.*?)\s*(CR|DR)$/i.exec(value)
  if (marked) {
    value = marked[1] ?? ''
    if (marked[2]?.toUpperCase() === 'DR') negate = !negate
  }
  // A sign may come before or after the currency: "-$5", "$-5", "AUD 5".
  value = value.replace(/^([+-]?)\s*(?:A?\$|AUD)\s*/i, '$1')
  // Parentheses, CR and DR already give the sign; another would contradict.
  if ((parenthesized || marked) && /^[+-]/.test(value)) return null
  const cents = parseAmount(value)
  if (cents === null) return null
  return negate && cents !== 0 ? -cents : cents
}
