// Ledger records as the page sees them, and the schemas the main process
// checks every payload against.
import { z } from 'zod'
import { isIsoDate } from './dates'
import { CURRENCIES, MAX_CENTS } from './money'
import type { Currency } from './money'

export const ACCOUNT_TYPES = ['bank', 'savings', 'credit', 'cash'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const NAME_MAX = 100
export const DESCRIPTION_MAX = 500
export const NOTES_MAX = 2000
export const SEARCH_MAX = 200
/** Rows per page of transactions. */
export const PAGE_MAX = 500

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const name = z.string().trim().min(1).max(NAME_MAX)
const cents = z.number().int().min(-MAX_CENTS).max(MAX_CENTS)
const date = z.string().refine(isIsoDate)

export const accountFields = z.strictObject({
  name,
  type: z.enum(ACCOUNT_TYPES),
  currency: z.enum(CURRENCIES),
  openingBalanceCents: cents,
})

export const categoryFields = z.strictObject({
  name,
  parentId: id.nullable(),
})

export const transactionFields = z.strictObject({
  accountId: id,
  date,
  amountCents: cents,
  description: z.string().trim().min(1).max(DESCRIPTION_MAX),
  categoryId: id.nullable(),
  notes: z.string().trim().max(NOTES_MAX),
})

export const transactionFilter = z.strictObject({
  accountId: id.optional(),
  /** A category with its subcategories, or 'none' for uncategorized. */
  category: z.union([id, z.literal('none')]).optional(),
  from: date.optional(),
  to: date.optional(),
  /** Matched against the description and notes. */
  text: z.string().max(SEARCH_MAX).optional(),
})

export const transactionCursor = z.strictObject({ date, id })

export const schemas = {
  id: z.strictObject({ id }),
  accountUpdate: accountFields.extend({ id }),
  categoryUpdate: categoryFields.extend({ id }),
  transactionUpdate: transactionFields.extend({ id }),
  transactionPage: z.strictObject({
    filter: transactionFilter,
    after: transactionCursor.optional(),
    limit: z.number().int().min(1).max(PAGE_MAX),
  }),
}

export type AccountFields = z.infer<typeof accountFields>
export type CategoryFields = z.infer<typeof categoryFields>
export type TransactionFields = z.infer<typeof transactionFields>
export type TransactionFilter = z.infer<typeof transactionFilter>
export type TransactionCursor = z.infer<typeof transactionCursor>

export interface Account extends AccountFields {
  id: number
  /** The opening balance plus every transaction. */
  balanceCents: number
  transactionCount: number
}

export interface Category extends CategoryFields {
  id: number
  transactionCount: number
}

export interface Transaction extends TransactionFields {
  id: number
  /** The account's currency. */
  currency: Currency
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
