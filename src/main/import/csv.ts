import { CsvError, parse, type Options } from 'csv-parse/sync'
import { decode, type Encoding } from './decode'

/** A file larger than this is refused before it is read. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_ROWS = 50_000
export const MAX_COLUMNS = 64
/** Characters in one record; a whole year of a bank account is far less. */
export const MAX_RECORD = 64 * 1024

const DELIMITERS = [',', ';', '\t'] as const
const SAMPLE_LINES = 20

export type FileProblem =
  | 'too-large'
  | 'too-many-rows'
  | 'too-many-columns'
  | 'record-too-long'
  | 'not-csv'
  | 'empty'

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

const median = (values: number[]) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0

/**
 * The delimiter that splits the first lines into the most columns. A bank
 * export has one per field, so a description's commas or semicolons, which
 * are quoted or rare, do not outvote it.
 */
function detectDelimiter(text: string): string {
  let best: string = DELIMITERS[0]
  let bestColumns = 1
  for (const delimiter of DELIMITERS) {
    let rows: Row[]
    try {
      rows = parseRows(text, { delimiter, to_line: SAMPLE_LINES })
    } catch {
      continue
    }
    const columns = median(rows.map((row) => row.cells.length))
    if (columns > bestColumns) {
      best = delimiter
      bestColumns = columns
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
