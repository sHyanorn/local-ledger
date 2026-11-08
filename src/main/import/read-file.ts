import { constants } from 'node:fs'
import { open, stat, type FileHandle } from 'node:fs/promises'
import { MAX_FILE_BYTES } from './csv'

/**
 * The bytes of the file the user chose: only a regular file, opened without
 * waiting (a pipe or device would block), checked through its handle to be
 * the file that was looked at, and read only up to the limit, whatever size
 * the file system reports.
 */
export async function readChosen(
  path: string,
): Promise<Uint8Array | 'too-large' | 'unreadable'> {
  let handle: FileHandle | undefined
  try {
    const seen = await stat(path)
    if (!seen.isFile()) return 'unreadable'
    // O_NONBLOCK is POSIX; Windows has no FIFOs to block on.
    handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      opened.dev !== seen.dev ||
      opened.ino !== seen.ino
    ) {
      return 'unreadable'
    }
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
