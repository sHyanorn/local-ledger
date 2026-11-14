import { CsvError, parse, type Options } from 'csv-parse/sync'
import type { Encoding, FileProblem } from '../../shared/imports'
import { MAX_COLUMNS, MAX_FILE_BYTES } from '../../shared/imports'
import { decode } from './decode'

export const MAX_ROWS = 50_000
export { MAX_COLUMNS, MAX_FILE_BYTES }
/** Characters in one record; a whole year of a bank account is far less. */
export const MAX_RECORD = 64 * 1024

const DELIMITERS = [',', ';', '\t'] as const
const SAMPLE_LINES = 20

/** The file as a whole cannot be imported; the code says why. */
export class FileError extends Error {
  readonly code: FileProblem

  constructor(code: FileProblem) {
    super(code)
    this.name = 'FileError'
    this.code = code
  }
}

/** A record and the line of the file it ends on, for messages. */
export interface Row {
  line: number
  cells: string[]
}

export interface Table {
  encoding: Encoding
  delimiter: string
  rows: Row[]
}

const base: Options = {
  bom: true,
  trim: true,
  relax_quotes: true,
  relax_column_count: true,
  skip_empty_lines: true,
  skip_records_with_empty_values: true,
  max_record_size: MAX_RECORD,
}

function parseRows(text: string, options: Options): Row[] {
  try {
    const records = parse(text, {
      ...base,
      ...options,
      info: true,
    }) as unknown as {
      record: string[]
      info: { lines: number }
    }[]
    return records.map(({ record, info }) => ({
      line: info.lines,
      cells: record,
    }))
  } catch (error) {
    if (error instanceof CsvError && error.code === 'CSV_MAX_RECORD_SIZE') {
      throw new FileError('record-too-long')
    }
    throw new FileError('not-csv')
  }
}

/** The most common row width, the wider on a tie, and the share of rows with it. */
export function usualWidth(widths: readonly number[]): {
  width: number
  share: number
} {
  const counts = new Map<number, number>()
  for (const width of widths) counts.set(width, (counts.get(width) ?? 0) + 1)
  let width = 0
  let count = 0
  for (const [each, n] of counts) {
    if (n > count || (n === count && each > width)) {
      width = each
      count = n
    }
  }
  return { width, share: widths.length === 0 ? 0 : count / widths.length }
}

/**
 * Row widths without trailing empty cells, which a trailing delimiter adds.
 * Only an empty cell counts: one of spaces held in quotes is a value.
 */
export const width = (cells: readonly string[]) => {
  let end = cells.length
  while (end > 0 && cells[end - 1] === '') end--
  return end
}

/**
 * The delimiter that splits most of the first lines into the same number
 * of columns. A bank export has one per field on every line; a comma inside
 * an amount or a description splits only some lines. Among those that
 * qualify, one that also splits the first line (often a header) into that
 * number wins, then the one with more columns, then the more consistent.
 */
function detectDelimiter(text: string): string {
  let best: string = DELIMITERS[0]
  let bestScore: [number, number, number] = [0, 1, 0]
  for (const delimiter of DELIMITERS) {
    let rows: Row[]
    try {
      rows = parseRows(text, { delimiter, to_line: SAMPLE_LINES })
    } catch {
      continue
    }
    const usual = usualWidth(rows.map((row) => width(row.cells)))
    if (usual.share <= 0.5 || usual.width < 2) continue
    const firstFits = width(rows[0]?.cells ?? []) === usual.width ? 1 : 0
    const score: [number, number, number] = [
      firstFits,
      usual.width,
      usual.share,
    ]
    const better = score.findIndex((value, n) => value !== bestScore[n])
    if (better !== -1 && score[better]! > bestScore[better]!) {
      best = delimiter
      bestScore = score
    }
  }
  return best
}

/** The rows of a CSV file, within the limits above. */
export function readTable(bytes: Uint8Array, encoding?: Encoding): Table {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new FileError('too-large')
  const decoded = decode(bytes, encoding)
  const delimiter = detectDelimiter(decoded.text)
  // One row past the limit is enough to know the file is over it.
  const rows = parseRows(decoded.text, { delimiter, to: MAX_ROWS + 1 })
  if (rows.length === 0) throw new FileError('empty')
  if (rows.length > MAX_ROWS) throw new FileError('too-many-rows')
  if (rows.some((row) => row.cells.length > MAX_COLUMNS)) {
    throw new FileError('too-many-columns')
  }
  return { encoding: decoded.encoding, delimiter, rows }
}

/**
 * Rows longer than usual, in a semicolon- or tab-separated file, with the
 * extra cells joined back into the given column: a description holding the
 * delimiter without quotes splits there, and the cells after it shift. A
 * comma-separated file is left alone, since there a longer row is more
 * often an amount with an unquoted thousands separator, which joining
 * would turn into a wrong amount; applyMapping lists such a row instead.
 */
export function joinOverflow(
  rows: readonly Row[],
  delimiter: string,
  column: number | undefined,
): Row[] {
  if (delimiter === ',' || column === undefined) return [...rows]
  const usual = usualWidth(rows.map((row) => width(row.cells))).width
  return rows.map((row) => {
    // A trailing delimiter adds an empty cell, not a split description.
    const extra = width(row.cells) - usual
    if (extra <= 0 || column >= usual) return row
    const cells = [
      ...row.cells.slice(0, column),
      row.cells
        .slice(column, column + extra + 1)
        .join(delimiter === ';' ? '; ' : ' '),
      ...row.cells.slice(column + extra + 1),
    ]
    return { line: row.line, cells }
  })
}
