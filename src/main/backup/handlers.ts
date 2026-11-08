// Backing up and restoring the vault. The page sends passwords; the main
// process shows the save and open dialogs and keeps the chosen backup, and
// the backup it has checked, until restored, discarded, or the vault locks
// or unlocks.
import { basename } from 'node:path'
import { dialog, type BaseWindow } from 'electron'
import { readChosen } from '../import/read-file'
import { cleanText } from '../import/mapping'
import { isoDate } from '../../shared/dates'
import { handle } from '../ipc'
import { writeOwnerOnly } from '../owner-only'
import { readBackup } from '../vault/backup'
import { LockedError, type StagedBackup, type Vault } from '../vault/vault'

export const BACKUP_EXTENSION = 'llbackup'
/** Larger than any ledger this app is made for. */
export const MAX_BACKUP_BYTES = 1024 * 1024 * 1024

export function handleBackup(
  vault: Vault,
  window: () => BaseWindow | null,
  devOrigin?: string,
): void {
  // Replaced at every lock and unlock, so work begun before one stops.
  let state = new AbortController()
  /** The backup file chosen for a restore, and once checked, its staged copy. */
  let chosen: { file: Buffer; staged: StagedBackup | null } | null = null
  const forget = () => {
    if (chosen?.staged) vault.discardBackup(chosen.staged)
    chosen = null
  }
  vault.onChange(() => {
    state.abort()
    state = new AbortController()
    forget()
  })
  /** A restore starts from setup, with no vault, or from an open one. */
  const restoring = () => {
    const now = vault.state
    if (now !== 'new' && now !== 'unlocked') throw new LockedError()
    return now
  }

  handle(
    'backup:save',
    async ({ password }) => {
      const signal = state.signal
      const made = await vault.backup(password)
      if (!made.ok) {
        if (made.reason === 'locked') throw new LockedError()
        return { ok: false, reason: made.reason }
      }
      const options = {
        defaultPath: `Local Ledger ${isoDate(new Date())}.${BACKUP_EXTENSION}`,
        filters: [
          { name: 'Local Ledger Backup', extensions: [BACKUP_EXTENSION] },
        ],
      }
      const parent = window()
      const chosen = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options)
      if (chosen.canceled || !chosen.filePath) {
        return { ok: false, reason: 'cancelled' }
      }
      if (signal.aborted) throw new LockedError()
      try {
        await writeOwnerOnly(chosen.filePath, made.file)
        return { ok: true }
      } catch {
        return { ok: false, reason: 'unwritable' }
      }
    },
    devOrigin,
  )

  handle(
    'restore:open',
    async () => {
      restoring()
      const signal = state.signal
      const options = {
        properties: ['openFile' as const],
        filters: [
          { name: 'Local Ledger Backup', extensions: [BACKUP_EXTENSION] },
        ],
      }
      const parent = window()
      const picked = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      const path = picked.filePaths[0]
      if (picked.canceled || path === undefined) {
        return { ok: false, reason: 'cancelled' } as const
      }
      if (signal.aborted) throw new LockedError()
      const bytes = await readChosen(path, MAX_BACKUP_BYTES)
      if (typeof bytes === 'string')
        return { ok: false, reason: bytes } as const
      const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)
      if (!readBackup(file)) return { ok: false, reason: 'invalid' } as const
      if (signal.aborted) throw new LockedError()
      forget()
      chosen = { file, staged: null }
      const name = cleanText(basename(path)).slice(0, 255) || 'backup'
      return { ok: true, name } as const
    },
    devOrigin,
  )
  handle(
    'restore:check',
    async ({ password }) => {
      restoring()
      const signal = state.signal
      const pending = chosen
      if (!pending) return { ok: false, reason: 'no-file' } as const
      const checked = await vault.checkBackup(pending.file, password)
      if (!checked.ok) return checked
      // A lock, unlock or another file since: this check belongs to none.
      if (signal.aborted || chosen !== pending) {
        vault.discardBackup(checked.staged)
        throw new LockedError()
      }
      if (pending.staged) vault.discardBackup(pending.staged)
      pending.staged = checked.staged
      return { ok: true, summary: checked.staged.summary } as const
    },
    devOrigin,
  )
  handle(
    'restore:commit',
    async ({ currentPassword }) => {
      const now = restoring()
      const staged = chosen?.staged
      if (!staged) return { ok: false, reason: 'not-checked' } as const
      // From setup there is no current password; from an open vault there is.
      if ((now === 'new') !== (currentPassword === null))
        return { ok: false, reason: 'exists' } as const
      const result = await vault.restore(staged, currentPassword)
      if (result.ok || result.reason !== 'wrong-password') forget()
      if (result.ok) return result
      if (result.reason === 'locked') throw new LockedError()
      return { ok: false, reason: result.reason }
    },
    devOrigin,
  )
  handle(
    'restore:discard',
    () => {
      restoring()
      forget()
    },
    devOrigin,
  )
}
