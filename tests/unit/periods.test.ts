import { afterEach, describe, expect, it, vi } from 'vitest'
import { periodRange } from '../../src/renderer/src/ledger/format'

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
  // The formatter is made when its module loads, so each zone loads it anew.
  // West of UTC a date read as UTC shows a day early if shown in local time;
  // east of it, a date read as local time shows a day early in UTC.
  const zone = process.env.TZ
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
    vi.resetModules()
  })

  it.each(['America/Los_Angeles', 'UTC', 'Australia/Melbourne'])(
    'writes the calendar date in %s',
    async (timeZone) => {
      process.env.TZ = timeZone
      vi.resetModules()
      const { formatDate } =
        await import('../../src/renderer/src/ledger/format')
      expect(formatDate('2026-11-08')).toBe('8 Nov 2026')
      expect(formatDate('2026-01-01')).toBe('1 Jan 2026')
    },
  )
})
