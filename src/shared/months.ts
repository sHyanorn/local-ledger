// Months as YYYY-MM text, shared by the main process and the page.

/** The month `offset` months from this one. */
export function shiftMonth(month: string, offset: number): string {
  const [year = 0, number = 1] = month.split('-').map(Number)
  const total = year * 12 + (number - 1) + offset
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

const MONTH = new Intl.DateTimeFormat('en-AU', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "November 2026" from "2026-11". */
export function formatMonth(month: string): string {
  return MONTH.format(new Date(`${month}-01T00:00:00Z`))
}
