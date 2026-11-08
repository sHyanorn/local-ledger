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
})
