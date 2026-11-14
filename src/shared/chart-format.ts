import type { Currency } from './money'
import { centsToDecimal, formatAmount } from './money'

const compact = new Map<Currency, Intl.NumberFormat>()

/** "$1.2K" for an axis; only for display, where rounding is the point. */
export function compactAmount(currency: Currency) {
  let format = compact.get(currency)
  if (!format) {
    format = new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    })
    compact.set(currency, format)
  }
  const chosen = format
  return (cents: number) => chosen.format(centsToDecimal(cents) as `${number}`)
}

/** The exact amount, for tooltips and labels. */
export const exactAmount = (currency: Currency) => (cents: number) =>
  formatAmount(cents, currency)

const SHORT_MONTH = new Intl.DateTimeFormat('en-AU', {
  month: 'short',
  timeZone: 'UTC',
})

/** "Nov" from "2026-11". */
export const shortMonth = (month: string) =>
  SHORT_MONTH.format(new Date(`${month}-01T00:00:00Z`))
