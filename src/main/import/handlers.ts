// IPC handlers for importing CSV files. The page never names a path: the
// file comes from the system's open dialog, shown here.
import type { BaseWindow } from 'electron'
import { fileLabel, showOpen } from '../dialogs'
import { readChosen } from '../read-file'
import type { Handle } from '../ipc'
import type { Vault } from '../vault/vault'
import { undoBatch, listBatches } from './batches'
import { MAX_FILE_BYTES } from './csv'
import { ImportSession } from './session'

export function handleImport(
  vault: Vault,
  window: () => BaseWindow | null,
  handle: Handle,
): void {
  const session = new ImportSession()
  // A waiting file belongs to the vault state it was chosen in.
  vault.onChange(() => session.clear())
  const db = () => vault.database()

  handle('import:open', async () => {
    db() // Fails when locked, before any dialog opens.
    const chosen = await showOpen(window(), {
      properties: ['openFile'],
      filters: [{ name: 'CSV files', extensions: ['csv', 'txt'] }],
    })
    const path = chosen.filePaths[0]
    if (chosen.canceled || path === undefined) {
      return { ok: false, reason: 'cancelled' } as const
    }
    // The vault may have locked while the dialog was open.
    db()
    const bytes = await readChosen(path, MAX_FILE_BYTES)
    if (typeof bytes === 'string') return { ok: false, reason: bytes } as const
    const name = fileLabel(path, 'file.csv')
    try {
      return session.open(db(), name, bytes)
    } catch (error) {
      bytes.fill(0)
      throw error
    }
  })
  handle('import:drop', ({ name, bytes }) => {
    // The page read the file; from here it is treated as a chosen one.
    const copy = Buffer.from(bytes)
    bytes.fill(0)
    try {
      return session.open(db(), fileLabel(name, 'file.csv'), copy)
    } catch (error) {
      copy.fill(0)
      throw error
    }
  })
  handle('import:preview', (request) => session.preview(db(), request))
  handle('import:commit', (request) => session.commit(db(), request))
  handle('import:discard', ({ id }) => {
    db()
    session.discard(id)
  })
  handle('import:batches', () => listBatches(db()))
  handle('import:undo', ({ id }) => undoBatch(db(), id))
}
