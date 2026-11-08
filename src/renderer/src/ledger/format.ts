import { isoDate } from '../../../shared/dates'

const DATE = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "8 Nov 2026" from "2026-11-08". */
export function formatDate(iso: string): string {
  return DATE.format(new Date(`${iso}T00:00:00Z`))
}

export const PERIODS = {
  all: 'All Time',
  'this-month': 'This Month',
  'last-month': 'Last Month',
  'this-year': 'This Year',
  custom: 'Custom…',
} as const
export type Period = keyof typeof PERIODS

/** The first and last day of a preset period, counted from today. */
export function periodRange(
  period: Exclude<Period, 'custom'>,
  today = new Date(),
): { from?: string; to?: string } {
  const year = today.getFullYear()
  const month = today.getMonth()
  const day = (y: number, m: number, d: number) => isoDate(new Date(y, m, d))
  switch (period) {
    case 'all':
      return {}
    case 'this-month':
      return { from: day(year, month, 1), to: day(year, month + 1, 0) }
    case 'last-month':
      return { from: day(year, month - 1, 1), to: day(year, month, 0) }
    case 'this-year':
      return { from: day(year, 0, 1), to: day(year, 11, 31) }
  }
}

/** The month of a date, as YYYY-MM, by the local calendar. */
export function monthOf(today = new Date()): string {
  return isoDate(today).slice(0, 7)
}

/** The month `offset` months from this one. */
export function shiftMonth(month: string, offset: number): string {
  const [year = 0, number = 1] = month.split('-').map(Number)
  return monthOf(new Date(year, number - 1 + offset, 1))
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
