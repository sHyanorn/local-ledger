// The structure of a bank CSV export, to check the import templates against
// real files: encoding, line endings, quoting, columns, and the kind of value
// in each column. It never includes a value, a file name or a path; header
// names appear only when they are NAB's or Westpac's own.
import { readTable } from '../../src/main/import/csv'
import { detectLayout } from '../../src/main/import/templates'
import { dateOrders, parseBankAmount } from '../../src/main/import/values'

/** Each field of a raw line, and whether it was quoted. */
function quotedFields(line: string, delimiter: string): boolean[] {
  const quoted: boolean[] = []
  let start = true
  let inQuotes = false
  for (const char of line) {
    if (start) {
      quoted.push(char === '"')
      start = false
    }
    if (char === '"') inQuotes = !inQuotes
    else if (char === delimiter && !inQuotes) start = true
  }
  if (start) quoted.push(false)
  return quoted
}

/** What kind of value a cell holds, without the value. */
function kind(cell: string): string {
  const value = cell.trim()
  if (value === '') return 'empty'
  if (dateOrders([value]).length > 0) {
    return `date ${value.replace(/\d/g, '9').replace(/[a-z]/gi, 'a')}`
  }
  if (parseBankAmount(value) !== null) {
    const sign = /^\s*\+/.test(value)
      ? '+'
      : /^\s*-|^\(/.test(value)
        ? '-'
        : 'unsigned'
    const decimals = /\.(\d+)/.exec(value)?.[1]?.length ?? 0
    const parts = [`amount ${sign}`, `${decimals} decimals`]
    if (/\d,\d/.test(value)) parts.push('thousands ","')
    if (/\$|AUD/i.test(value)) parts.push('currency')
    if (/^\(/.test(value)) parts.push('parentheses')
    if (/(CR|DR)$/i.test(value)) parts.push('CR/DR')
    return parts.join(', ')
  }
  if (!/[a-z]/i.test(value)) return `digits ${value.replace(/\d/g, '9')}`
  return 'text'
}

export function describe(bytes: Buffer, index: number): string[] {
  const out = [`File ${index + 1}`]
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const raw = bytes.toString('latin1')
  const crlf = (raw.match(/\r\n/g) ?? []).length
  const lf = (raw.match(/\n/g) ?? []).length - crlf
  const table = readTable(bytes)
  out.push(
    `  encoding ${table.encoding}${bom ? ' with BOM' : ''}; line breaks ${
      crlf && lf ? 'mixed' : crlf ? 'CRLF' : 'LF'
    }; final line break ${/\n$/.test(raw) ? 'yes' : 'no'}; delimiter ${JSON.stringify(table.delimiter)}`,
  )
  const layout = detectLayout(table.rows)
  out.push(
    `  template ${layout?.template ?? (layout ? 'none (guessed)' : 'none')}`,
  )

  const first = table.rows[0]?.cells ?? []
  const header =
    !first.some((cell) => dateOrders([cell]).length > 0) &&
    !first.some((cell) => cell.trim() !== '' && parseBankAmount(cell) !== null)
  // Only a bank's own header, matched word for word, is safe to print; any
  // other first row may be data or a preamble with names and numbers.
  if (
    header &&
    (layout?.template === 'nab' || layout?.template === 'westpac')
  ) {
    out.push(`  header ${JSON.stringify(first)}`)
  } else if (header) {
    out.push(`  first row, not printed: ${first.map(kind).join('; ')}`)
  }
  const data = header ? table.rows.slice(1) : table.rows
  const widths = new Map<number, number>()
  for (const row of data) {
    widths.set(row.cells.length, (widths.get(row.cells.length) ?? 0) + 1)
  }
  out.push(
    `  ${data.length} data rows; columns per row: ${[...widths]
      .map(([width, count]) => `${width} (${count} rows)`)
      .join(', ')}`,
  )

  const lines = raw.replace(/^ï»¿/, '').split(/\r?\n/)
  const sampleLine = lines[header ? 1 : 0] ?? ''
  const quoted = quotedFields(sampleLine, table.delimiter)
  const columns = Math.max(0, ...widths.keys())
  for (let column = 0; column < columns; column++) {
    const kinds = new Map<string, number>()
    for (const row of data) {
      const name = kind(row.cells[column] ?? '')
      kinds.set(name, (kinds.get(name) ?? 0) + 1)
    }
    const top = [...kinds]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, count]) => `${name} ×${count}`)
      .join('; ')
    out.push(
      `  column ${column + 1}${quoted[column] ? ' (quoted)' : ''}: ${top}`,
    )
  }
  return out
}
