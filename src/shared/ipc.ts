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
}
