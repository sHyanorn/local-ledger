// Inconsistencies of the kind an old ledger may carry, for tests: ones
// quick_check does not look for, so the database still opens.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { applyKey } from '../../src/main/vault/database'
import { deriveHere } from '../../src/main/vault/kdf'
import { openKey } from '../../src/main/vault/keys'
import { parseVaultFile } from '../../src/main/vault/vault-file'
import type { Vault } from '../../src/main/vault/vault'

function connect(path: string, key: Uint8Array) {
  const db = new Database(path)
  db.pragma("cipher = 'sqlcipher'")
  db.pragma('legacy = 4')
  applyKey(db, key)
  return db
}

/**
 * Leaves an index whose entries no longer match its table, which
 * integrity_check reports: drop the index from the schema, change the rows,
 * put the index back.
 */
export function corruptIndex(path: string, key: Uint8Array): void {
  const unsafe = () => {
    const db = connect(path, key)
    db.unsafeMode(true)
    db.pragma('writable_schema = ON')
    return db
  }
  let db = unsafe()
  db.exec(
    'CREATE TABLE fake (n INTEGER); CREATE INDEX fake_n ON fake (n); INSERT INTO fake VALUES (1), (2), (3)',
  )
  const index = db
    .prepare("SELECT rootpage, sql FROM sqlite_schema WHERE name = 'fake_n'")
    .get()
  db.prepare("DELETE FROM sqlite_schema WHERE name = 'fake_n'").run()
  db.close()
  db = unsafe()
  db.exec('UPDATE fake SET n = n + 10')
  db.prepare(
    "INSERT INTO sqlite_schema VALUES ('index', 'fake_n', 'fake', @rootpage, @sql)",
  ).run(index)
  db.close()
}

/** Leaves rows that refer to missing ones, which foreign_key_check reports. */
export function breakReferences(path: string, key: Uint8Array): void {
  const db = connect(path, key)
  db.pragma('foreign_keys = OFF')
  db.exec('DELETE FROM categories')
  db.close()
}

/** corruptIndex on the database of a locked vault. */
export async function corruptVaultIndex(
  vault: Vault,
  password: string,
): Promise<void> {
  const file = parseVaultFile(
    readFileSync(join(vault.dir, 'vault.json'), 'utf8'),
  )
  if (!file) throw new Error('unreadable vault.json')
  const key = await openKey(file, password, deriveHere)
  if (!key) throw new Error('wrong password')
  corruptIndex(join(vault.dir, `ledger-${file.generation}.db`), key)
}
