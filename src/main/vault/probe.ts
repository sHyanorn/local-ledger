// What the self-test (D012) checks of the open database where it is open:
// the SQLite build, and that the file on disk is encrypted.
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Vault } from './vault'

export interface VaultProbe {
  sqlite: string
  cipher: string
  /** The file starts with SQLite's plaintext header. */
  plaintextHeader: boolean
  /** The file opens as a plain SQLite database, without the key. */
  opensWithoutKey: boolean
}

export function probeVault(vault: Vault): VaultProbe {
  const db = vault.database()
  return {
    sqlite: db.prepare('SELECT sqlite_version()').pluck().get() as string,
    cipher: db.pragma('cipher', { simple: true }) as string,
    plaintextHeader:
      readFileSync(db.name).subarray(0, 16).toString('latin1') ===
      'SQLite format 3\0',
    opensWithoutKey: opensWithoutKey(db.name),
  }
}

function opensWithoutKey(file: string): boolean {
  const db = new Database(file, { readonly: true })
  try {
    db.pragma('user_version')
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}
