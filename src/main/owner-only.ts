import { existsSync } from 'node:fs'
import { open, realpath, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { flushDirectory } from './vault/files'

/** Waits between tries of a rename that Windows refuses, in milliseconds. */
const RENAME_WAITS = [50, 100, 200, 400, 800]
/** What Windows reports while another program holds the target open. */
const HELD = new Set(['EPERM', 'EACCES', 'EBUSY'])

/**
 * Renames over the target. On Windows a virus scanner or a sync client that
 * has the target open makes the rename fail for a moment, so it is tried
 * again for about a second and a half.
 */
async function renameOver(from: string, to: string): Promise<void> {
  for (const wait of RENAME_WAITS) {
    try {
      return await rename(from, to)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform !== 'win32' || !code || !HELD.has(code)) throw error
      await sleep(wait)
    }
  }
  await rename(from, to)
}

/**
 * Writes the file readable by the user only, as the vault is, and so that a
 * failure or a crash leaves a file that was already there as it was: the
 * bytes go to a temporary file beside it, which is flushed and renamed over
 * it, as the vault's own files are written. Throws when the file could not
 * be written; nothing of the attempt stays then.
 */
export async function writeOwnerOnly(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  // A link is followed, not replaced.
  const target = await realpath(path).catch(() => path)
  const temporary = `${target}.tmp`
  let created = false
  try {
    const file = await open(temporary, 'w', 0o600)
    created = true
    try {
      if (process.platform !== 'win32') await file.chmod(0o600)
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    await renameOver(temporary, target)
  } catch (error) {
    if (created) await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
  // The file is in place; a flush that fails does not undo it.
  flushDirectory(dirname(target))
}

/**
 * Why a write failed, as the page reports it: a file that was already there
 * is still there, unchanged, or there is none.
 */
export const writeFailure = (path: string) =>
  existsSync(path) ? 'unwritable-kept' : 'unwritable'
