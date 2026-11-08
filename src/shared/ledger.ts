// Ledger records as the page sees them. Free of zod: the page imports it,
// and zod probes for eval, which the CSP refuses. The schemas are in
// schemas.ts, for the main process.
import type { Currency } from './money'
import type {
  AccountFields,
  CategoryFields,
  TransactionCursor,
  TransactionFields,
} from './schemas'

export type {
  AccountFields,
  CategoryFields,
  TransactionCursor,
  TransactionFields,
  TransactionFilter,
} from './schemas'

export const ACCOUNT_TYPES = ['bank', 'savings', 'credit', 'cash'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const NAME_MAX = 100
export const DESCRIPTION_MAX = 500
export const NOTES_MAX = 2000
export const SEARCH_MAX = 200
/** Rows per page of transactions. */
export const PAGE_MAX = 500

export interface Account extends AccountFields {
  id: number
  /** The opening balance plus every transaction. */
  balanceCents: number
  transactionCount: number
}

export interface Category extends CategoryFields {
  id: number
  transactionCount: number
  /** Rules that give this category. */
  ruleCount: number
}

export interface Transaction extends TransactionFields {
  id: number
  /** The account's currency. */
  currency: Currency
  /** The other account, when this is one side of a transfer. */
  transferAccountId: number | null
}

export interface TransactionPage {
  rows: Transaction[]
  /** Where the next page starts, or null after the last. */
  next: TransactionCursor | null
}

/** The sum of matching transactions in one currency; currencies never mix. */
export interface CurrencyTotal {
  currency: Currency
  count: number
  cents: number
}
