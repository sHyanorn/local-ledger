// CSV import as the page sees it. Free of zod, like ledger.ts.
import type { Mapping } from './schemas'

export type { Mapping, AmountColumns, ImportTarget } from './schemas'

export const ENCODINGS = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'windows-1252',
] as const
export type Encoding = (typeof ENCODINGS)[number]

/** The order of day, month and year in a numeric date. */
export const DATE_ORDERS = ['dmy', 'mdy', 'ymd'] as const
export type DateOrder = (typeof DATE_ORDERS)[number]

export const TEMPLATES = ['commbank', 'nab', 'anz', 'westpac'] as const
export type TemplateId = (typeof TEMPLATES)[number]

/** Why a whole file cannot be imported. */
export type FileProblem =
  | 'too-large'
  | 'too-many-rows'
  | 'too-many-columns'
  | 'record-too-long'
  | 'not-csv'
  | 'empty'
  | 'unreadable'

/** Why one row cannot be imported. */
export type RowProblem =
  'date' | 'amount' | 'description' | 'description-too-long'

/** The most columns a mapping can name: the file limit. */
export const MAX_COLUMNS = 64
/** Rows shown while choosing the columns. */
export const SAMPLE_ROWS = 8

/** A file read and waiting in the main process to be imported. */
export interface ImportFile {
  /** Names the waiting file in later calls. */
  id: string
  fileName: string
  encoding: Encoding
  template: TemplateId | null
  /** The columns as detected, guessed or remembered; null if none could be. */
  mapping: Mapping | null
  /** The date orders every date fits; more than one means the user chooses. */
  dateOrders: DateOrder[]
  columns: number
  /** The first rows, to choose columns by. */
  sample: string[][]
  /** The bank accounts in a file that holds several, with their row counts. */
  groups: { key: string; rows: number }[] | null
}

export interface RowError {
  line: number
  problem: RowProblem
  /** The cell at fault. */
  value: string
}

export interface ExistingMatch {
  id: number
  date: string
  amountCents: number
  description: string
}

export type RowStatus =
  /** Not in the ledger. */
  | 'new'
  /** Imported before, from this or an overlapping file. */
  | 'duplicate'
  /** Close to a transaction already in the ledger; the user decides. */
  | 'possible'

export interface PreviewRow {
  /** Position among the file's readable rows; names the row when importing. */
  index: number
  line: number
  accountId: number
  date: string
  amountCents: number
  description: string
  status: RowStatus
  match: ExistingMatch | null
  /** The category the first matching rule gives, if any. */
  categoryId: number | null
}

export interface ImportPreview {
  rows: PreviewRow[]
  errors: RowError[]
}

export interface ImportBatch {
  id: number
  fileName: string
  importedAt: string
  /** Transactions of the import still in the ledger. */
  count: number
  /** Of those, how many the user has changed since. */
  edited: number
}
