// Preferences stored in the vault's settings table. A missing or unreadable
// value reads as its default, so a vault from before a setting existed works.
import { CURRENCIES, type Currency } from '../../shared/money'
import {
  DEFAULT_SETTINGS,
  IDLE_LOCK_CHOICES,
  type Settings,
} from '../../shared/settings'
import type { Db } from '../vault/database'

const KEYS = {
  homeCurrency: 'home_currency',
  idleLockMinutes: 'idle_lock_minutes',
} as const

export function getSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const stored = new Map(rows.map((row) => [row.key, row.value]))
  const currency = stored.get(KEYS.homeCurrency)
  const minutes = Number(stored.get(KEYS.idleLockMinutes))
  return {
    homeCurrency: CURRENCIES.includes(currency as Currency)
      ? (currency as Currency)
      : DEFAULT_SETTINGS.homeCurrency,
    idleLockMinutes:
      IDLE_LOCK_CHOICES.find((choice) => choice === minutes) ??
      DEFAULT_SETTINGS.idleLockMinutes,
  }
}

/** Stores the given settings, leaving the others as they are. */
export function updateSettings(db: Db, changes: Partial<Settings>): Settings {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  )
  db.transaction(() => {
    for (const [name, value] of Object.entries(changes)) {
      if (value === undefined) continue
      upsert.run(KEYS[name as keyof Settings], String(value))
    }
  })()
  return getSettings(db)
}
