import { open } from 'node:fs/promises'

/**
 * Writes the file readable by the user only, as the vault is: the mode is
 * set before writing, also on a file that already existed with another.
 */
export async function writeOwnerOnly(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const file = await open(path, 'w', 0o600)
  try {
    if (process.platform !== 'win32') await file.chmod(0o600)
    await file.writeFile(bytes)
  } finally {
    await file.close()
  }
}
