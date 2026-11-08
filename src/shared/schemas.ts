// The schemas the main process checks every IPC payload against.
import { z } from 'zod'
import { isIsoDate } from './dates'
import {
  ACCOUNT_TYPES,
  DESCRIPTION_MAX,
  NAME_MAX,
  NOTES_MAX,
  PAGE_MAX,
  SEARCH_MAX,
} from './ledger'
import { CURRENCIES, MAX_CENTS } from './money'

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
/**
 * Trimmed text in Unicode's composed form (NFC), so text that looks the
 * same is stored the same, and names and searches compare as written.
 */
const text = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .transform((value) => value.normalize('NFC'))
const name = text(NAME_MAX, 1)
const cents = z.number().int().min(-MAX_CENTS).max(MAX_CENTS)
/** A calendar date from 1900 to 2999. */
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
  description: text(DESCRIPTION_MAX, 1),
  categoryId: id.nullable(),
  notes: text(NOTES_MAX),
})

export const transactionFilter = z.strictObject({
  accountId: id.optional(),
  /** A category with its subcategories, or 'none' for uncategorized. */
  category: z.union([id, z.literal('none')]).optional(),
  from: date.optional(),
  to: date.optional(),
  /** Matched against the description and notes. */
  text: text(SEARCH_MAX).optional(),
})

export const transactionCursor = z.strictObject({ date, id })

export const schemas = {
  id: z.strictObject({ id }),
  accountUpdate: accountFields.extend({ id }),
  categoryUpdate: categoryFields.extend({ id }),
  transactionUpdate: transactionFields.extend({ id }),
  transactionCategory: z.strictObject({ id, categoryId: id.nullable() }),
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
