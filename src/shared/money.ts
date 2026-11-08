// Amounts are integer cents (D003). Text becomes cents and cents become text
// by string arithmetic only, so no floating-point rounding reaches a balance.

/** The largest amount stored: a hundred billion units of any currency. */
export const MAX_CENTS = 10_000_000_000_000

/** Currencies with two decimal places, which integer cents hold exactly. */
export const CURRENCIES = [
  'AUD',
  'CAD',
  'CNY',
  'EUR',
  'GBP',
  'HKD',
  'NZD',
  'SGD',
  'USD',
] as const
export type Currency = (typeof CURRENCIES)[number]

// An optional sign, digits with or without thousands commas, up to two decimals.
const AMOUNT = /^([+-])?(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?$/

/** Cents from text such as "1,234.56", "-12.5" or ".05"; null if it is not an amount. */
export function parseAmount(text: string): number | null {
  const match = AMOUNT.exec(text.trim())
  if (!match) return null
  const [, sign, whole = '', fraction = ''] = match
  if (whole === '' && fraction === '') return null
  const digits = (whole.replaceAll(',', '') + fraction.padEnd(2, '0')).replace(
    /^0+(?=\d)/,
    '',
  )
  // Longer than MAX_CENTS, so too large, and possibly beyond exact integers.
  if (digits.length > String(MAX_CENTS).length) return null
  const cents = Number(digits)
  if (cents > MAX_CENTS) return null
  return sign === '-' && cents !== 0 ? -cents : cents
}

/** The amount as a plain decimal, such as "-1234.50". */
export function centsToDecimal(cents: number): string {
  const digits = String(Math.abs(cents)).padStart(3, '0')
  const sign = cents < 0 ? '-' : ''
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`
}

const formats = new Map<Currency, Intl.NumberFormat>()

/** The amount in the currency's usual form, such as "-$1,234.50". */
export function formatAmount(cents: number, currency: Currency): string {
  let format = formats.get(currency)
  if (!format) {
    format = new Intl.NumberFormat('en-AU', { style: 'currency', currency })
    formats.set(currency, format)
  }
  // A decimal string is formatted exactly, without a detour through a float.
  return format.format(centsToDecimal(cents) as `${number}`)
}
