import { constants } from 'node:fs'
import { open, stat, type FileHandle } from 'node:fs/promises'

/**
 * The bytes of the file the user chose: only a regular file, opened without
 * waiting (a pipe or device would block), checked through its handle to be
 * the file that was looked at, and read only up to the limit, whatever size
 * the file system reports.
 */
export async function readChosen(
  path: string,
  limit: number,
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
    // Sized for what the file says it holds; a file that grows is read on
    // into further chunks, never past the limit.
    const chunks: Buffer[] = []
    let total = 0
    let chunk = Buffer.alloc(Math.min(limit, opened.size) + 1)
    let filled = 0
    while (total <= limit) {
      if (filled === chunk.length) {
        chunks.push(chunk)
        chunk = Buffer.alloc(Math.min(limit + 1 - total, 1 << 20))
        filled = 0
      }
      const { bytesRead } = await handle.read(
        chunk,
        filled,
        chunk.length - filled,
        null,
      )
      if (bytesRead === 0) break
      filled += bytesRead
      total += bytesRead
    }
    chunks.push(chunk.subarray(0, filled))
    const bytes = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks)
    if (chunks.length > 1) for (const each of chunks) each.fill(0)
    if (total > limit) {
      bytes.fill(0)
      return 'too-large'
    }
    return bytes
  } catch {
    return 'unreadable'
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
