const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar date written YYYY-MM-DD, from 1900 to 2999. */
export function isIsoDate(text: string): boolean {
  const match = ISO_DATE.exec(text)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ]
  if (year < 1900 || year > 2999) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** A local date as YYYY-MM-DD. */
export function isoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
