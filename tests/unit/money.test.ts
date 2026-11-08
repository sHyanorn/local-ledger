import { describe, expect, it } from 'vitest'
import { isIsoDate } from '../../src/shared/dates'
import {
  centsToDecimal,
  formatAmount,
  MAX_CENTS,
  parseAmount,
} from '../../src/shared/money'

describe('parseAmount', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['-12.05', -1205],
    ['+3', 300],
    ['.05', 5],
    ['0.10', 10],
    ['1,234.56', 123456],
    ['12,345,678', 1234567800],
    ['  7.00 ', 700],
    ['-0', 0],
    ['007', 700],
    ['1000000000.00', 100000000000],
    ['100000000000', MAX_CENTS],
  ])('reads %s as %i cents', (text, cents) => {
    expect(parseAmount(text)).toBe(cents)
  })

  it.each([
    '',
    '-',
    '.',
    '1.',
    '1.234',
    '1,23',
    '12,34.5',
    '1e3',
    '0x10',
    '$5',
    '5 6',
    'NaN',
    'Infinity',
    '100000000000.01',
    '99999999999999999999',
  ])('refuses %j', (text) => {
    expect(parseAmount(text)).toBeNull()
  })
})

describe('formatting', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [-5, '-0.05'],
    [123456, '1234.56'],
    [-MAX_CENTS, '-100000000000.00'],
  ])('writes %i cents as %s', (cents, decimal) => {
    expect(centsToDecimal(cents)).toBe(decimal)
  })

  it('formats exactly in the currency, without float rounding', () => {
    expect(formatAmount(-123456, 'AUD')).toBe('-$1,234.56')
    expect(formatAmount(MAX_CENTS - 1, 'AUD')).toBe('$99,999,999,999.99')
    // ICU builds differ in the symbol they give yuan in an en-AU format.
    expect(formatAmount(1050, 'CNY')).toMatch(/^(CN¥|CNY\s)10\.50$/)
  })

  it('round-trips through text', () => {
    for (const cents of [0, 1, -1, 99, 100, -12345, 987654321, MAX_CENTS]) {
      expect(parseAmount(centsToDecimal(cents))).toBe(cents)
    }
  })
})

describe('isIsoDate', () => {
  it.each(['2026-01-31', '2024-02-29', '1900-01-01', '2999-12-31'])(
    'accepts %s',
    (date) => expect(isIsoDate(date)).toBe(true),
  )

  it.each([
    '2026-02-30',
    '2025-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-1-01',
    '26-01-01',
    '1899-12-31',
    '3000-01-01',
    '2026-01-31T00:00',
    '',
  ])('refuses %j', (date) => expect(isIsoDate(date)).toBe(false))
})
