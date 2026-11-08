// Backing up and restoring the vault. The page sends passwords; the main
// process shows the save and open dialogs and keeps the chosen backup, and
// the backup it has checked, until restored, discarded, or the vault locks
// or unlocks.
import type { BaseWindow } from 'electron'
import { isoDate } from '../../shared/dates'
import { fileLabel, showOpen, showSave } from '../dialogs'
import { readChosen } from '../import/read-file'
import type { Handle } from '../ipc'
import { writeOwnerOnly } from '../owner-only'
import { readBackup } from '../vault/backup'
import {
  LockedError,
  signalUntilChange,
  type StagedBackup,
  type Vault,
} from '../vault/vault'

export const BACKUP_EXTENSION = 'llbackup'
/** Larger than any ledger this app is made for. */
export const MAX_BACKUP_BYTES = 1024 * 1024 * 1024

export function handleBackup(
  vault: Vault,
  window: () => BaseWindow | null,
  handle: Handle,
): { forget: () => void } {
  const currentSignal = signalUntilChange(vault)
  /** The backup file chosen for a restore, and once checked, its staged copy. */
  let chosen: { file: Buffer; staged: StagedBackup | null } | null = null
  const forget = () => {
    if (chosen?.staged) vault.discardBackup(chosen.staged)
    chosen = null
  }
  vault.onChange(() => forget())
  /** A restore runs from setup, from a vault that does not open, or from an open one. */
  const restoring = () => {
    const now = vault.state
    if (now === 'locked') throw new LockedError()
    return now
  }
  /** While a restore runs, the backup it uses stays where it is. */
  let committing = false
  const idle = () => {
    if (committing) throw new Error('busy')
  }

  handle('backup:save', async ({ password }) => {
    const signal = currentSignal()
    const made = await vault.backup(password)
    if (!made.ok) {
      if (made.reason === 'locked') throw new LockedError()
      return { ok: false, reason: made.reason }
    }
    const chosen = await showSave(window(), {
      defaultPath: `Local Ledger ${isoDate(new Date())}.${BACKUP_EXTENSION}`,
      filters: [
        { name: 'Local Ledger Backup', extensions: [BACKUP_EXTENSION] },
      ],
    })
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
  })

  handle('restore:open', async () => {
    restoring()
    idle()
    const signal = currentSignal()
    const picked = await showOpen(window(), {
      properties: ['openFile'],
      filters: [
        { name: 'Local Ledger Backup', extensions: [BACKUP_EXTENSION] },
      ],
    })
    const path = picked.filePaths[0]
    if (picked.canceled || path === undefined) {
      return { ok: false, reason: 'cancelled' } as const
    }
    if (signal.aborted) throw new LockedError()
    const bytes = await readChosen(path, MAX_BACKUP_BYTES)
    if (typeof bytes === 'string') return { ok: false, reason: bytes } as const
    const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)
    if (!readBackup(file)) return { ok: false, reason: 'invalid' } as const
    if (signal.aborted) throw new LockedError()
    forget()
    chosen = { file, staged: null }
    const name = fileLabel(path, 'backup')
    return { ok: true, name } as const
  })
  handle('restore:check', async ({ password }) => {
    restoring()
    idle()
    const signal = currentSignal()
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
  })
  handle('restore:commit', async ({ currentPassword }) => {
    const now = restoring()
    idle()
    const staged = chosen?.staged
    if (!staged) return { ok: false, reason: 'not-checked' } as const
    // From an open vault the current password is needed; otherwise none.
    if ((now === 'unlocked') !== (currentPassword !== null))
      return { ok: false, reason: 'exists' } as const
    committing = true
    let result: Awaited<ReturnType<Vault['restore']>>
    try {
      result = await vault.restore(staged, currentPassword)
    } finally {
      committing = false
    }
    if (result.ok || result.reason !== 'wrong-password') forget()
    if (result.ok) return result
    if (result.reason === 'locked') throw new LockedError()
    return { ok: false, reason: result.reason }
  })
  handle('restore:discard', () => {
    restoring()
    if (!committing) forget()
  })
  return { forget }
}
