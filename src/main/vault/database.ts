// The SQLCipher-compatible database (SQLite3 Multiple Ciphers, sqlcipher v4
// scheme) under the data key. The key reaches SQLite as a raw key, so no
// second KDF runs, and only through buffers that are wiped afterwards.
import Database from 'better-sqlite3-multiple-ciphers'
import { migrate } from './migrations'

export type Db = Database.Database

/** The file does not decrypt with the key, holds no ledger, or fails quick_check. */
export class DamagedError extends Error {
  constructor() {
    super('the database does not open with this key or is damaged')
    this.name = 'DamagedError'
  }
}

const HEX = '0123456789abcdef'

/** The bytes of the raw key literal x'<hex>', built without a string. */
export function rawKeyLiteral(key: Uint8Array): Buffer {
  const literal = Buffer.alloc(key.length * 2 + 3)
  literal[0] = 0x78 // x
  literal[1] = 0x27 // '
  key.forEach((byte, index) => {
    literal[2 + index * 2] = HEX.charCodeAt(byte >> 4)
    literal[3 + index * 2] = HEX.charCodeAt(byte & 0x0f)
  })
  literal[literal.length - 1] = 0x27
  return literal
}

function selectCipher(db: Db): void {
  db.pragma("cipher = 'sqlcipher'")
  db.pragma('legacy = 4')
}

/** Keys a connection; wipes the literal it builds. */
export function applyKey(db: Db, key: Uint8Array): void {
  const literal = rawKeyLiteral(key)
  try {
    db.key(literal)
  } finally {
    literal.fill(0)
  }
}

/** Changes the key of an open connection; wipes the literal it builds. */
export function changeKey(db: Db, key: Uint8Array): void {
  const literal = rawKeyLiteral(key)
  try {
    db.rekey(literal)
  } finally {
    literal.fill(0)
  }
}

/** Whether every page and index of the database reads back whole. */
export const passesIntegrityCheck = (db: Db): boolean =>
  db.pragma('integrity_check', { simple: true }) === 'ok'

/**
 * An existing ledger: the first read decrypts page 1 and so checks the key,
 * migrations have run at least once, and every page reads back. An empty
 * file decrypts under any key, so the second check matters.
 */
function isLedger(db: Db): boolean {
  try {
    return (
      db.pragma('user_version', { simple: true }) !== 0 &&
      db.pragma('quick_check', { simple: true }) === 'ok'
    )
  } catch {
    return false
  }
}

/**
 * Opens (or with `create`, creates) the database under the key and brings
 * its schema up to date. Throws DamagedError, before anything is written,
 * when an existing file is not a whole ledger under this key.
 */
export function openDatabase(
  file: string,
  key: Uint8Array,
  { create = false }: { create?: boolean } = {},
): Db {
  const db = new Database(file, { fileMustExist: !create })
  try {
    selectCipher(db)
    applyKey(db, key)
    if (!create && !isLedger(db)) throw new DamagedError()
    // One file, so a copy of it is the whole database.
    db.pragma('journal_mode = DELETE')
    db.pragma('synchronous = FULL')
    // macOS: flush the drive cache too, as Node's fsync does there.
    db.pragma('fullfsync = ON')
    db.pragma('foreign_keys = ON')
    // Sorts and temporary tables stay in memory, never in plaintext files.
    db.pragma('temp_store = MEMORY')
    migrate(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
