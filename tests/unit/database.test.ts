import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  openDatabase,
  rawKeyLiteral,
  WrongKeyError,
} from '../../src/main/vault/database'
import type { Db } from '../../src/main/vault/database'
import { migrations, NewerSchemaError } from '../../src/main/vault/migrations'

const KEY = Buffer.alloc(32, 0xab)
let dir: string
let file: string
const open: Db[] = []
const track = (db: Db) => (open.push(db), db)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-db-'))
  file = join(dir, 'ledger.db')
})
afterEach(() => {
  for (const db of open.splice(0)) if (db.open) db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('rawKeyLiteral', () => {
  it("spells x'<hex>'", () => {
    const key = Uint8Array.from([0x00, 0x0f, 0xa0, 0xff])
    expect(rawKeyLiteral(key).toString()).toBe("x'000fa0ff'")
  })
})

describe('openDatabase', () => {
  it('creates an encrypted database and opens it again with the key', () => {
    track(openDatabase(file, KEY, { create: true })).close()
    expect(readFileSync(file).subarray(0, 16).toString('latin1')).not.toBe(
      'SQLite format 3\0',
    )
    const db = track(openDatabase(file, KEY))
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
  })

  it('uses the key as a raw SQLCipher v4 key, with no second KDF', () => {
    track(openDatabase(file, KEY, { create: true })).close()
    // Opened as SQLCipher would open it, with the hex key spelled out.
    const db = track(new Database(file))
    db.pragma("cipher = 'sqlcipher'")
    db.pragma('legacy = 4')
    db.pragma(`key = "x'${KEY.toString('hex')}'"`)
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
  })

  it('refuses a wrong key, and no key', () => {
    track(openDatabase(file, KEY, { create: true })).close()
    expect(() => openDatabase(file, Buffer.alloc(32, 0xac))).toThrow(
      WrongKeyError,
    )
    const plain = track(new Database(file))
    expect(() => plain.pragma('user_version')).toThrow()
  })

  it('does not create a missing database unless asked', () => {
    expect(() => openDatabase(file, KEY)).toThrow()
  })

  it('sets the connection up for one durable file', () => {
    const db = track(openDatabase(file, KEY, { create: true }))
    expect(db.pragma('journal_mode', { simple: true })).toBe('delete')
    expect(db.pragma('synchronous', { simple: true })).toBe(2)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('temp_store', { simple: true })).toBe(2)
    expect(db.pragma('cipher', { simple: true })).toBe('sqlcipher')
  })
})

describe('schema', () => {
  let db: Db
  beforeEach(() => {
    db = track(openDatabase(file, KEY, { create: true }))
    db.prepare(
      "INSERT INTO accounts (name, type, currency) VALUES ('Everyday', 'bank', 'AUD')",
    ).run()
  })

  it('makes every table STRICT', () => {
    const tables = db
      .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table'")
      .pluck()
      .all() as string[]
    expect(tables.length).toBeGreaterThanOrEqual(6)
    for (const sql of tables) expect(sql).toMatch(/\)\s*STRICT$/)
  })

  it('stores amounts as integer cents only', () => {
    const insert = db.prepare(
      "INSERT INTO transactions (account_id, date, amount_cents, description) VALUES (1, '2026-01-31', ?, 'Fake')",
    )
    expect(() => insert.run(-1250)).not.toThrow()
    expect(() => insert.run(12.5)).toThrow()
    expect(() => insert.run('12.50')).toThrow()
  })

  it('checks dates, months and currencies', () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO transactions (account_id, date, amount_cents, description) VALUES (1, '31/01/2026', 1, 'Fake')",
        )
        .run(),
    ).toThrow()
    expect(() =>
      db
        .prepare(
          "INSERT INTO accounts (name, type, currency) VALUES ('Cash', 'cash', 'AUDX')",
        )
        .run(),
    ).toThrow()
  })

  it('enforces foreign keys', () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO transactions (account_id, date, amount_cents, description) VALUES (99, '2026-01-31', 1, 'Fake')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/)
  })
})

describe('migrate', () => {
  it('is a no-op on an up-to-date database', () => {
    track(openDatabase(file, KEY, { create: true })).close()
    const db = track(openDatabase(file, KEY))
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
  })

  it('refuses a database from a newer version of the app', () => {
    const db = track(openDatabase(file, KEY, { create: true }))
    db.pragma(`user_version = ${migrations.length + 1}`)
    db.close()
    expect(() => openDatabase(file, KEY)).toThrow(NewerSchemaError)
  })
})
