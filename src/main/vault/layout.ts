// Where the vault keeps its files under the user data directory, and the
// recovery and clearing of directories an interrupted create or restore
// leaves there.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { flushDirectory } from './files'
import { parseVaultFile, VAULT_FILE } from './vault-file'

export const VAULT_DIR = 'vault'
export const STAGING_PREFIX = 'vault.creating-'
/** A backup being checked before a restore; never a vault on its own. */
export const RESTORING_PREFIX = 'vault.restoring-'
/** Where a restore moves the vault it replaces; the app never deletes it. */
export const REPLACED_PREFIX = 'vault-before-restore-'

export const databaseName = (generation: number) => `ledger-${generation}.db`

/**
 * A whole vault in a staging directory, with none in place, means the
 * rename that put it in place was lost, in a power cut after a failed
 * directory flush: it is the vault, so it goes back into place. The
 * newest wins if there are several.
 */
export function recoverStaged(root: string, dir: string): void {
  try {
    if (existsSync(dir) || !existsSync(root)) return
    const staged = readdirSync(root)
      .filter((name) => name.startsWith(STAGING_PREFIX))
      .flatMap((name) => {
        const path = join(root, name)
        const time = wholeVaultTime(path)
        return time === null ? [] : [{ path, time }]
      })
      .sort((a, b) => b.time - a.time)
    if (!staged[0]) return
    renameSync(staged[0].path, dir)
    flushDirectory(root)
  } catch {
    // Left as found; the vault reads as new.
  }
}

/**
 * Removes staging directories before a create. Any left by an earlier run
 * held no whole vault, or startup would have recovered it; any from this
 * run belong to an attempt that failed.
 */
export function removeStaging(root: string): void {
  mkdirSync(root, { recursive: true })
  removeDirs(root, STAGING_PREFIX)
}

/**
 * Removes backups staged for a restore that did not happen. They are
 * copies of backup files the user still has.
 */
export function removeRestoring(root: string): void {
  try {
    removeDirs(root, RESTORING_PREFIX)
  } catch {
    // No user data directory yet.
  }
}

/** The name a restore gives the vault it replaces, such as vault-before-restore-2026-11-08T10-30-00. */
export function replacedName(now: Date): string {
  return `${REPLACED_PREFIX}${now.toISOString().slice(0, 19).replaceAll(':', '-')}`
}

/** Removes the directories under root whose names start with the prefix. */
function removeDirs(root: string, prefix: string): void {
  for (const name of readdirSync(root)) {
    if (name.startsWith(prefix)) {
      rmSync(join(root, name), { recursive: true, force: true })
    }
  }
}

/** When a directory holds a whole vault, the time its vault.json was written. */
function wholeVaultTime(dir: string): number | null {
  try {
    const path = join(dir, VAULT_FILE)
    const file = parseVaultFile(readFileSync(path, 'utf8'))
    if (!file || !existsSync(join(dir, databaseName(file.generation))))
      return null
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}
