// IPC handlers for importing CSV files. The page never names a path: the
// file comes from the system's open dialog, shown here.
import { open, type FileHandle } from 'node:fs/promises'
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

/**
 * The file's bytes, read through one handle: only a regular file, and only
 * up to the limit, whatever size the file system reports.
 */
async function readChosen(
  path: string,
): Promise<Uint8Array | 'too-large' | 'unreadable'> {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'r')
    if (!(await handle.stat()).isFile()) return 'unreadable'
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.length - total,
        null,
      )
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > MAX_FILE_BYTES) {
      buffer.fill(0)
      return 'too-large'
    }
    return buffer.subarray(0, total)
  } catch {
    return 'unreadable'
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
