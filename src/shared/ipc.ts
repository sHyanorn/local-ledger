// IPC channels between preload and the main process, with the schema the
// main process validates each payload against.
import { z } from 'zod'
import {
  accountFields,
  categoryFields,
  schemas,
  transactionFields,
  transactionFilter,
} from './schemas'
import type {
  FileProblem,
  ImportBatch,
  ImportFile,
  ImportPreview,
} from './imports'
import type { Rule, RuleReach, RuleSuggestion } from './rules'
import type { PossibleTransfer, TransferSide } from './transfers'
import type { MonthBudgets } from './budgets'
import type { ReportData, TrendPoint } from './reports'
import type {
  Account,
  Category,
  CurrencyTotal,
  TransactionPage,
} from './ledger'
import { PASSWORD_MAX, PASSWORD_MIN, passwordLength } from './password'

export { PASSWORD_MAX, PASSWORD_MIN, passwordLength } from './password'

// Bounds the work done before normalization; NFKC can lengthen a string.
const passwordText = z.string().max(PASSWORD_MAX * 4)

/** A password being set: the full length rule applies. */
const newPassword = passwordText.refine((password) => {
  const length = passwordLength(password)
  return length >= PASSWORD_MIN && length <= PASSWORD_MAX
})

/** A password being checked: only the upper bound, so a raised minimum never locks anyone out. */
const givenPassword = passwordText.refine((password) => {
  const length = passwordLength(password)
  return length >= 1 && length <= PASSWORD_MAX
})

export const channels = {
  'vault:status': z.undefined(),
  'vault:create': z.strictObject({ password: newPassword }),
  'vault:unlock': z.strictObject({ password: givenPassword }),
  'vault:lock': z.undefined(),
  'vault:change-password': z.strictObject({
    current: givenPassword,
    next: newPassword,
  }),
  'accounts:list': z.undefined(),
  'accounts:create': accountFields,
  'accounts:update': schemas.accountUpdate,
  'accounts:delete': schemas.id,
  'categories:list': z.undefined(),
  'categories:create': categoryFields,
  'categories:update': schemas.categoryUpdate,
  'categories:delete': schemas.id,
  'transactions:page': schemas.transactionPage,
  'transactions:totals': transactionFilter,
  'transactions:create': transactionFields,
  'transactions:update': schemas.transactionUpdate,
  'transactions:set-category': schemas.transactionCategory,
  'transactions:delete': schemas.id,
  'import:open': z.undefined(),
  'import:preview': schemas.importPreview,
  'import:commit': schemas.importCommit,
  'import:discard': schemas.importDiscard,
  'import:batches': z.undefined(),
  'import:undo': schemas.id,
  'rules:list': z.undefined(),
  'rules:create': schemas.ruleCreate,
  'rules:update': schemas.ruleUpdate,
  'rules:delete': schemas.id,
  'rules:move': schemas.ruleMove,
  'rules:reach': schemas.ruleReach,
  'rules:suggest': schemas.id,
  'rules:decline': schemas.ruleDismiss,
  'transfers:possible': z.undefined(),
  'transfers:count': z.undefined(),
  'transfers:choices': schemas.id,
  'transfers:link': schemas.transferLink,
  'transfers:unlink': schemas.id,
  'transfers:reject': schemas.transferReject,
  'budgets:month': schemas.budgetMonth,
  'budgets:set': schemas.budgetSet,
  'reports:month': schemas.report,
  'reports:trend': schemas.trend,
} as const

export type Channel = keyof typeof channels
export type Payload<C extends Channel> = z.infer<(typeof channels)[C]>

export type VaultState = 'new' | 'locked' | 'unlocked' | 'damaged'

export type Outcome<Reason extends string> =
  { ok: true } | { ok: false; reason: Reason }

/** An outcome that names the new record. */
export type Created<Reason extends string> =
  { ok: true; id: number } | { ok: false; reason: Reason }

export interface Results {
  'vault:status': VaultState
  'vault:create': Outcome<'exists' | 'locked'>
  'vault:unlock': Outcome<
    'wrong-password' | 'no-vault' | 'damaged' | 'newer' | 'locked'
  >
  'vault:lock': void
  'vault:change-password': Outcome<'wrong-password' | 'locked' | 'damaged'>
  'accounts:list': Account[]
  'accounts:create': Created<'duplicate'>
  'accounts:update': Outcome<'duplicate' | 'not-found' | 'currency-in-use'>
  'accounts:delete': Outcome<'in-use' | 'not-found'>
  'categories:list': Category[]
  'categories:create': Created<'duplicate' | 'not-found' | 'too-deep'>
  'categories:update': Outcome<'duplicate' | 'not-found' | 'too-deep'>
  'categories:delete': Outcome<'not-found'>
  'transactions:page': TransactionPage
  'transactions:totals': CurrencyTotal[]
  'transactions:create': Created<'not-found'>
  'transactions:update': Outcome<'not-found'>
  'transactions:set-category': Outcome<'not-found'>
  'transactions:delete': Outcome<'not-found'>
  'import:open':
    | { ok: true; file: ImportFile }
    | { ok: false; reason: FileProblem | 'cancelled' }
  'import:preview':
    | { ok: true; preview: ImportPreview }
    | { ok: false; reason: FileProblem | 'not-found' }
  'import:commit':
    | { ok: true; id: number; count: number; paired: number }
    | { ok: false; reason: FileProblem | 'not-found' | 'nothing' | 'changed' }
  'import:discard': void
  'import:batches': ImportBatch[]
  'import:undo':
    { ok: true; count: number } | { ok: false; reason: 'not-found' }
  'rules:list': Rule[]
  'rules:create':
    | { ok: true; id: number; applied: number }
    | { ok: false; reason: 'not-found' }
  'rules:update': Outcome<'not-found'>
  'rules:delete': Outcome<'not-found'>
  'rules:move': Outcome<'not-found'>
  'rules:reach': RuleReach
  'rules:suggest': RuleSuggestion | null
  'rules:decline': void
  'transfers:possible': PossibleTransfer[]
  'transfers:count': number
  'transfers:choices': TransferSide[]
  'transfers:link': Outcome<'not-found' | 'not-a-pair'>
  'transfers:unlink': Outcome<'not-found'>
  'transfers:reject': Outcome<'not-found'>
  'budgets:month': MonthBudgets
  'budgets:set': Outcome<'not-found'>
  'reports:month': ReportData
  'reports:trend': TrendPoint[]
}
