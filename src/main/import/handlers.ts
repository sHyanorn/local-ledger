// IPC handlers for importing CSV files. The page never names a path: the
// file comes from the system's open dialog, shown here.
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { dialog, type BaseWindow } from 'electron'
import { handle } from '../ipc'
import type { Vault } from '../vault/vault'
import { undoBatch, listBatches } from './batches'
import { MAX_FILE_BYTES } from './csv'
import { cleanText } from './mapping'
import { ImportSession } from './session'

export function handleImport(
  vault: Vault,
  window: () => BaseWindow | null,
  devOrigin?: string,
): void {
  const session = new ImportSession()
  // A waiting file belongs to the vault state it was chosen in.
  vault.onChange(() => session.clear())
  const db = () => vault.database()

  handle(
    'import:open',
    async () => {
      db() // Fails when locked, before any dialog opens.
      const options = {
        properties: ['openFile' as const],
        filters: [{ name: 'CSV files', extensions: ['csv', 'txt'] }],
      }
      const parent = window()
      const chosen = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      const path = chosen.filePaths[0]
      if (chosen.canceled || path === undefined) {
        return { ok: false, reason: 'cancelled' } as const
      }
      let bytes: Uint8Array
      try {
        if ((await stat(path)).size > MAX_FILE_BYTES) {
          return { ok: false, reason: 'too-large' } as const
        }
        bytes = await readFile(path)
      } catch {
        return { ok: false, reason: 'unreadable' } as const
      }
      // The vault may have locked while the dialog was open.
      const name = cleanText(basename(path)).slice(0, 255) || 'file.csv'
      return session.open(db(), name, bytes)
    },
    devOrigin,
  )
  handle(
    'import:preview',
    (request) => session.preview(db(), request),
    devOrigin,
  )
  handle('import:commit', (request) => session.commit(db(), request), devOrigin)
  handle('import:discard', ({ id }) => session.discard(id), devOrigin)
  handle('import:batches', () => listBatches(db()), devOrigin)
  handle('import:undo', ({ id }) => undoBatch(db(), id), devOrigin)
}
