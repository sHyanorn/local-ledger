// The schemas the main process checks every IPC payload against.
import { z } from 'zod'
import { isIsoDate } from './dates'
import { DATE_ORDERS, ENCODINGS, MAX_COLUMNS } from './imports'
import { PATTERN_MAX, RULE_MATCHES } from './rules'
import {
  ACCOUNT_TYPES,
  DESCRIPTION_MAX,
  NAME_MAX,
  NOTES_MAX,
  PAGE_MAX,
  SEARCH_MAX,
} from './ledger'
import { EXPORT_FORMATS } from './export'
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
/** A calendar month, YYYY-MM, from 1900 to 2999. */
const month = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .refine((value) => isIsoDate(`${value}-01`))

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

const column = z
  .number()
  .int()
  .min(0)
  .max(MAX_COLUMNS - 1)

export const amountColumns = z.discriminatedUnion('kind', [
  /** One column, money out negative; `negate` for files that write it positive. */
  z.strictObject({ kind: z.literal('signed'), column, negate: z.boolean() }),
  /** Money out and money in in separate columns, both written positive. */
  z.strictObject({ kind: z.literal('split'), debit: column, credit: column }),
])

/** Which columns of a CSV file hold what. */
export const mapping = z.strictObject({
  /** The first row names the columns. */
  header: z.boolean(),
  date: column,
  dateOrder: z.enum(DATE_ORDERS),
  /** The first of these columns that is not empty. */
  description: z.array(column).min(1).max(3),
  amount: amountColumns,
})

/** The account for one group of a file's rows; null skips the group. */
export const importTarget = z.strictObject({
  /** The bank account the rows name, or '' for a file of one account. */
  key: z.string().max(64),
  accountId: id.nullable(),
})

const importRequest = z.strictObject({
  id: z.uuid(),
  encoding: z.enum(ENCODINGS),
  mapping,
  targets: z.array(importTarget).min(1).max(50),
})

export const ruleFields = z.strictObject({
  pattern: text(PATTERN_MAX, 1),
  match: z.enum(RULE_MATCHES),
  categoryId: id,
})

export const schemas = {
  id: z.strictObject({ id }),
  accountUpdate: accountFields.extend({ id }),
  categoryUpdate: categoryFields.extend({ id }),
  transactionUpdate: transactionFields.extend({ id }),
  transactionCategory: z.strictObject({ id, categoryId: id.nullable() }),
  importPreview: importRequest,
  importCommit: importRequest.extend({
    /** The indexes of the preview rows to import. */
    selected: z.array(z.number().int().min(0).max(50_000)).max(50_000),
  }),
  importDiscard: z.strictObject({ id: z.uuid() }),
  ruleCreate: ruleFields.extend({
    /** Also categorize the uncategorized transactions it matches first. */
    apply: z.boolean(),
  }),
  ruleUpdate: ruleFields.extend({ id }),
  ruleMove: z.strictObject({
    id,
    offset: z.union([z.literal(-1), z.literal(1)]),
  }),
  ruleReach: ruleFields
    .omit({ categoryId: true })
    .extend({ id: id.optional() }),
  ruleDismiss: z.strictObject({ pattern: text(DESCRIPTION_MAX, 1) }),
  transferLink: z.strictObject({ id, otherId: id }),
  budgetMonth: z.strictObject({ month }),
  exportSave: z.strictObject({
    month,
    currency: z.enum(CURRENCIES),
    format: z.enum(EXPORT_FORMATS),
  }),
  report: z.strictObject({ month, currency: z.enum(CURRENCIES) }),
  trend: z.strictObject({
    categoryId: id,
    month,
    currency: z.enum(CURRENCIES),
  }),
  budgetSet: z.strictObject({
    categoryId: id,
    month,
    amountCents: z.number().int().min(0).max(MAX_CENTS).nullable(),
  }),
  transferReject: z.strictObject({ outId: id, inId: id }),
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
export type AmountColumns = z.infer<typeof amountColumns>
export type Mapping = z.infer<typeof mapping>
export type ImportTarget = z.infer<typeof importTarget>
export type RuleFields = z.infer<typeof ruleFields>
