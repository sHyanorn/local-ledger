// Backing up the vault. The page sends the master password, which the
// backup is sealed under; the main process asks where to save the file.
import { dialog, type BaseWindow } from 'electron'
import { isoDate } from '../../shared/dates'
import { handle } from '../ipc'
import { writeOwnerOnly } from '../owner-only'
import { LockedError, type Vault } from '../vault/vault'

export const BACKUP_EXTENSION = 'llbackup'

export function handleBackup(
  vault: Vault,
  window: () => BaseWindow | null,
  devOrigin?: string,
): void {
  // Replaced at every lock and unlock, so a backup begun before one stops.
  let state = new AbortController()
  vault.onChange(() => {
    state.abort()
    state = new AbortController()
  })

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
}
