// IPC handlers for importing CSV files. The page never names a path: the
// file comes from the system's open dialog, shown here.
import { basename } from 'node:path'
import { dialog, type BaseWindow } from 'electron'
import { handle } from '../ipc'
import type { Vault } from '../vault/vault'
import { undoBatch, listBatches } from './batches'
import { cleanText } from './mapping'
import { readChosen } from './read-file'
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
      // The vault may have locked while the dialog was open.
      db()
      const bytes = await readChosen(path)
      if (typeof bytes === 'string')
        return { ok: false, reason: bytes } as const
      const name = cleanText(basename(path)).slice(0, 255) || 'file.csv'
      try {
        return session.open(db(), name, bytes)
      } catch (error) {
        bytes.fill(0)
        throw error
      }
    },
    devOrigin,
  )
  handle(
    'import:preview',
    (request) => session.preview(db(), request),
    devOrigin,
  )
  handle('import:commit', (request) => session.commit(db(), request), devOrigin)
  handle(
    'import:discard',
    ({ id }) => {
      db()
      session.discard(id)
    },
    devOrigin,
  )
  handle('import:batches', () => listBatches(db()), devOrigin)
  handle('import:undo', ({ id }) => undoBatch(db(), id), devOrigin)
}
