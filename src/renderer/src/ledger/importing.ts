import {
  MAX_FILE_BYTES,
  type DateOrder,
  type Encoding,
  type FileProblem,
  type ImportFile,
  type RowError,
  type TemplateId,
} from '../../../shared/imports'

export const FILE_PROBLEMS: Record<FileProblem, string> = {
  'too-large': 'The file is larger than 10 MB.',
  'too-many-rows': 'The file has more than 50,000 rows.',
  'too-many-columns': 'The file has more than 64 columns.',
  'record-too-long': 'A row in the file is longer than 64 KB.',
  'not-csv': 'The file could not be read as CSV.',
  empty: 'The file has no rows.',
  unreadable: 'The file could not be opened.',
}

export const TEMPLATE_NAMES: Record<TemplateId, string> = {
  commbank: 'CommBank',
  nab: 'NAB',
  anz: 'ANZ',
  westpac: 'Westpac',
}

export const DATE_ORDER_NAMES: Record<DateOrder, string> = {
  dmy: 'Day/Month/Year',
  mdy: 'Month/Day/Year',
  ymd: 'Year/Month/Day',
}

export const ENCODING_NAMES: Record<Encoding, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'windows-1252': 'Windows (Western)',
}

/** Why a row was left out, with the cell at fault. */
export function rowProblem({ problem, value }: RowError): string {
  switch (problem) {
    case 'date':
      return value === '' ? 'no date' : `“${value}” is not a date`
    case 'amount':
      return value === '' ? 'no amount' : `“${value}” is not an amount`
    case 'description':
      return 'no description'
    case 'description-too-long':
      return 'description longer than 500 characters'
  }
}

/**
 * Reads a file dropped on the window and hands its bytes to the main
 * process, which reads them as it reads a chosen file.
 */
export async function dropImportFile(
  file: File,
): Promise<{ file: ImportFile } | { problem: string }> {
  if (file.size > MAX_FILE_BYTES) return { problem: FILE_PROBLEMS['too-large'] }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const result = await window.ledger.imports.drop(file.name, bytes)
  bytes.fill(0)
  if (result.ok) return { file: result.file }
  return { problem: FILE_PROBLEMS[result.reason] }
}

/**
 * Asks for a file and reads it; returns the file, or why not. Cancelling
 * the dialog returns null.
 */
export async function chooseImportFile(): Promise<
  { file: ImportFile } | { problem: string } | null
> {
  const result = await window.ledger.imports.open()
  if (result.ok) return { file: result.file }
  if (result.reason === 'cancelled') return null
  return { problem: FILE_PROBLEMS[result.reason] }
}
