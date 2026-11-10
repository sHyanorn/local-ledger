// A backup's database staged for a restore: written to a directory of its
// own under the user data directory, checked, and re-encrypted under a
// fresh data key sealed with the backup's password.
import { randomFillSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupSummary } from '../../shared/backup'
import {
  changeKey,
  openDatabase,
  openFailure,
  passesIntegrityCheck,
  passesQuickCheck,
} from './database'
import { seal } from './envelope'
import { syncFile } from './files'
import { KEY_BYTES } from './kdf'
import { databaseName, RESTORING_PREFIX } from './layout'
import { associatedData } from './vault-file'
import type { VaultFile } from './vault-file'

/**
 * A backup checked and staged for a restore. Its database is opened, checked
 * and brought up to this app's schema; `file` seals its data key under the
 * backup's own password.
 */
export interface StagedBackup {
  dir: string
  file: VaultFile
  dataKey: Buffer
  summary: BackupSummary
}

/**
 * Stages the database of a backup whose key has opened: it must open as a
 * vault's does and, under its new key, pass integrity_check, or quick_check
 * if it came failing the first. The caller wipes `backupKey` and
 * `sealingKey`; on failure nothing is left behind.
 */
export function stageBackup(
  root: string,
  database: Buffer,
  kdf: VaultFile['kdf'],
  backupKey: Buffer,
  sealingKey: Buffer,
):
  | { ok: true; staged: StagedBackup }
  | { ok: false; reason: 'newer' | 'damaged' } {
  let dir: string | null = null
  let dataKey: Buffer | null = null
  try {
    dir = mkdtempSync(join(root, RESTORING_PREFIX))
    const path = join(dir, databaseName(1))
    writeFileSync(path, database, { mode: 0o600 })
    let summary: BackupSummary
    // A fresh data key, as a password change draws: the backup's key,
    // which old copies of vault.json or the backup itself still unseal,
    // must not open the vault this becomes.
    const fresh = randomFillSync(Buffer.alloc(KEY_BYTES))
    let rekeyed = false
    try {
      const db = openDatabase(path, backupKey)
      try {
        const whole = passesIntegrityCheck(db)
        changeKey(db, fresh)
        if (!(whole ? passesIntegrityCheck(db) : passesQuickCheck(db)))
          return { ok: false, reason: 'damaged' }
        summary = db
          .prepare(
            `SELECT (SELECT count(*) FROM accounts) AS accounts,
               (SELECT count(*) FROM transactions) AS transactions,
               (SELECT max(date) FROM transactions) AS lastDate`,
          )
          .get() as BackupSummary
      } finally {
        db.close()
      }
      rekeyed = true
    } catch (error) {
      const reason = openFailure(error)
      if (reason) return { ok: false, reason }
      throw error
    } finally {
      // Every way out but a checked, rekeyed copy leaves the key unused.
      if (!rekeyed) fresh.fill(0)
    }
    dataKey = fresh
    syncFile(path)
    // Sealed now, so a restore with the backup's password needs nothing
    // more from the user; the password is not kept.
    const file = {
      generation: 1,
      kdf,
      key: seal(sealingKey, dataKey, associatedData({ generation: 1, kdf })),
    }
    const staged = { dir, file, dataKey, summary }
    dir = null
    dataKey = null
    return { ok: true, staged }
  } finally {
    dataKey?.fill(0)
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}
