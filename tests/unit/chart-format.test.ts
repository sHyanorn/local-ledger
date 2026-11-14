import { describe, expect, it } from 'vitest'
import { compactAmount } from '../../src/shared/chart-format'

describe('compactAmount', () => {
  // Halves round away from zero: 1.15 shows as 1.2, 1,250 as 1.3K.
  it.each([
    ['AUD', 0, '$0'],
    ['AUD', 450, '$4.5'],
    ['AUD', -1526, '-$15.3'],
    ['AUD', 115, '$1.2'],
    ['AUD', 125000, '$1.3K'],
    ['AUD', -123456, '-$1.2K'],
    ['AUD', 99999999, '$1M'],
    ['AUD', 1e13, '$100B'],
    ['AUD', -1e13, '-$100B'],
    ['CNY', 2500000, 'CNY\u00a025K'],
    ['EUR', -4999999, '-EUR\u00a050K'],
    ['USD', 5000000, 'USD\u00a050K'],
  ] as const)('%s %d cents is %s', (currency, cents, label) => {
    expect(compactAmount(currency)(cents)).toBe(label)
  })
})
