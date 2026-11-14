import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe as suite, expect, it } from 'vitest'
import { describe } from '../../scripts/csv-shape/shape'
import { readTable } from '../../src/main/import/csv'

const dir = join(__dirname, '../fixtures/csv')
const samples = readdirSync(dir).filter((name) => name.endsWith('.csv'))

suite('csv:shape', () => {
  it.each(samples)('prints no value from %s', (name) => {
    const bytes = readFileSync(join(dir, name))
    const output = describe(bytes, 0).join('\n')
    const rows = readTable(bytes).rows
    // A first row of names is printed; every other cell must not be.
    const header = output.includes('  header ')
    for (const row of header ? rows.slice(1) : rows) {
      for (const cell of row.cells) {
        if (cell.trim().length >= 3) expect(output).not.toContain(cell.trim())
      }
    }
    expect(output).not.toContain(name)
  })

  it('names the template and the columns', () => {
    const output = describe(readFileSync(join(dir, 'commbank.csv')), 0)
    expect(output).toEqual([
      'File 1',
      '  encoding utf-8; line breaks LF; final line break no; delimiter ","',
      '  template commbank',
      '  6 data rows; columns per row: 4 (6 rows)',
      '  column 1: date 99/99/9999 ×6',
      '  column 2 (quoted): amount -, 2 decimals ×4; amount +, 2 decimals ×1; amount -, 2 decimals, thousands "," ×1',
      '  column 3 (quoted): text ×6',
      '  column 4 (quoted): amount +, 2 decimals ×4; amount -, 2 decimals ×2',
    ])
  })

  it('does not print a first row it cannot recognize as a bank header', () => {
    const output = describe(
      Buffer.from(
        'Statement for Fake Person 000-000 12345678\n' +
          '2026-05-29T10:00:00,AUD 1 234.56,SALARY FAKE PERSON 0400000000\n',
      ),
      0,
    ).join('\n')
    expect(output).not.toContain('Fake Person')
    expect(output).not.toContain('SALARY')
    expect(output).toContain('first row, not printed: text')
  })

  it('prints no value of text in any script', () => {
    const output = describe(
      Buffer.from(
        '01/05/2026,-15.26,北京烤鸭店\n' +
          '02/05/2026,-20.00,李小明 转账\n' +
          '03/05/2026,-7.50,Кафе Пушкин\n',
      ),
      0,
    ).join('\n')
    expect(output).toContain('column 3: text ×3')
    for (const value of ['北京', '李小明', 'Пушкин']) {
      expect(output).not.toContain(value)
    }
  })

  it('describes a first row with a name in another script by kind', () => {
    const output = describe(
      Buffer.from(
        '账户名：李小明,账号：6222021234567890\n' +
          '01/05/2026,-15.26,FAKE CAFE,+984.74\n' +
          '02/05/2026,-20.00,FAKE SHOP,+964.74\n',
      ),
      0,
    ).join('\n')
    expect(output).toContain('first row, not printed: text; text')
    expect(output).not.toContain('李小明')
  })

  it('keeps only digits and separators of a cell without letters', () => {
    const output = describe(
      Buffer.from(
        '01/05/2026,-15.26,FAKE CAFE,☎ 0400-000 000\n' +
          '02/05/2026,-20.00,FAKE SHOP,☎ 0400-000 001\n',
      ),
      0,
    ).join('\n')
    expect(output).toContain('column 4: digits # 9999-999 999 ×2')
    expect(output).not.toContain('☎')
  })

  it('prints only the names of a bank header it matched', () => {
    const output = describe(
      Buffer.from(
        'Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Fake Person 0400000000\n' +
          '29 May 26,-15.26,000-000 000000001,,EFTPOS DEBIT,FAKE MARKET,1234.56,Groceries,Fake Market,x\n',
      ),
      0,
    ).join('\n')
    expect(output).toContain('"Merchant Name"], then text')
    expect(output).not.toContain('Fake Person')
  })
})
