// Preferences kept inside the vault. Free of zod, like ledger.ts.
import type { Currency } from './money'

/** Minutes of system idle time before the vault locks; there is no "never". */
export const IDLE_LOCK_CHOICES = [1, 5, 15, 30] as const
export type IdleLockMinutes = (typeof IDLE_LOCK_CHOICES)[number]

export interface Settings {
  /** Budgets and their spending are in this currency (D028). */
  homeCurrency: Currency
  idleLockMinutes: IdleLockMinutes
}

export const DEFAULT_SETTINGS: Settings = {
  homeCurrency: 'AUD',
  idleLockMinutes: 5,
}
