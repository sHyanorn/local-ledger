// IPC channels between preload and the main process, with the schema the
// main process validates each payload against.
import { z } from 'zod'
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
} as const

export type Channel = keyof typeof channels
export type Payload<C extends Channel> = z.infer<(typeof channels)[C]>

export type VaultState = 'new' | 'locked' | 'unlocked' | 'damaged'

export type Outcome<Reason extends string> =
  { ok: true } | { ok: false; reason: Reason }

export interface Results {
  'vault:status': VaultState
  'vault:create': Outcome<'exists'>
  'vault:unlock': Outcome<'wrong-password' | 'no-vault' | 'damaged' | 'newer'>
  'vault:lock': void
  'vault:change-password': Outcome<'wrong-password' | 'locked' | 'damaged'>
}
