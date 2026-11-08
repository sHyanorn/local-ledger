import { describe, expect, it } from 'vitest'
import { formatDate, periodRange } from '../../src/renderer/src/ledger/format'

describe('periodRange', () => {
  it.each([
    ['this-month', new Date(2026, 1, 15), '2026-02-01', '2026-02-28'],
    ['this-month', new Date(2024, 1, 29), '2024-02-01', '2024-02-29'],
    ['last-month', new Date(2026, 0, 31), '2025-12-01', '2025-12-31'],
    ['last-month', new Date(2026, 2, 31), '2026-02-01', '2026-02-28'],
    ['this-year', new Date(2026, 11, 31), '2026-01-01', '2026-12-31'],
  ] as const)('%s on %s runs from %s to %s', (period, today, from, to) => {
    expect(periodRange(period, today)).toEqual({ from, to })
  })

  it('has no bounds for all time', () => {
    expect(periodRange('all')).toEqual({})
  })
})

describe('formatDate', () => {
  it('writes the calendar date, whatever the time zone', () => {
    expect(formatDate('2026-11-08')).toBe('8 Nov 2026')
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026')
  })
})
