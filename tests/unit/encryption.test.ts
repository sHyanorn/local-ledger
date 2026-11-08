import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deriveHere } from '../../src/main/vault/kdf'
import type { KdfParams } from '../../src/main/vault/kdf'
import { Vault } from '../../src/main/vault/vault'

const FAST: KdfParams = { memoryKiB: 19_456, iterations: 2, parallelism: 1 }
const PASSWORD = 'fake ledger passphrase for tests'
// Fake data that must never appear in clear on disk.
const MARKERS = ['FAKE-PAYEE-7c1e9a', 'FAKE-NOTE-52bd04', 'FAKE-ACCOUNT-e83f11']

let root: string
let vault: Vault
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ledger-encryption-'))
  vault = new Vault(root, { derive: deriveHere, kdf: FAST })
  await vault.create(PASSWORD)
  const db = vault.database()
  db.prepare(
    'INSERT INTO accounts (name, type, currency) VALUES (?, ?, ?)',
  ).run(MARKERS[2], 'bank', 'AUD')
  const insert = db.prepare(
    "INSERT INTO transactions (account_id, date, amount_cents, description, notes) VALUES (1, '2026-01-31', ?, ?, ?)",
  )
  db.transaction(() => {
    for (let i = 0; i < 500; i++)
      insert.run(-1250 - i, `${MARKERS[0]} ${i}`, MARKERS[1])
  })()
})
afterEach(async () => {
  vault.lock()
  rmSync(root, { recursive: true, force: true })
})

/** The markers found in a file's bytes, as UTF-8 or UTF-16 text. */
function plaintextIn(file: string): string[] {
  const bytes = readFileSync(file)
  return MARKERS.filter(
    (marker) =>
      bytes.includes(Buffer.from(marker, 'utf8')) ||
      bytes.includes(Buffer.from(marker, 'utf16le')),
  )
}

describe('on disk', () => {
  it('the database file holds no fake data in clear', async () => {
    vault.lock()
    for (const name of readdirSync(vault.dir)) {
      expect(plaintextIn(join(vault.dir, name)), name).toEqual([])
    }
  })

  it('the scan finds the markers in an unencrypted database and its journal', () => {
    // Guards the tests here against a scan that can never match.
    const file = join(root, 'plain.db')
    const plain = new Database(file)
    plain.pragma('journal_mode = DELETE')
    plain.exec('CREATE TABLE t (text TEXT)')
    const insert = plain.prepare('INSERT INTO t VALUES (?)')
    for (const marker of MARKERS) insert.run(marker)
    expect(plaintextIn(file)).toEqual(MARKERS)
    plain.exec('BEGIN IMMEDIATE')
    plain.prepare("UPDATE t SET text = 'changed'").run()
    expect(plaintextIn(`${file}-journal`)).toEqual(MARKERS)
    plain.exec('ROLLBACK')
    plain.close()
  })

  it('the rollback journal holds no fake data in clear during a write', () => {
    const db = vault.database()
    const journal = join(vault.dir, 'ledger-1.db-journal')
    db.exec('BEGIN IMMEDIATE')
    try {
      // The journal now takes the original pages, which hold the markers.
      db.prepare('UPDATE transactions SET description = ?, notes = ?').run(
        'changed',
        'changed',
      )
      db.prepare('UPDATE accounts SET name = ?').run('changed')
      expect(existsSync(journal)).toBe(true)
      expect(readFileSync(journal).length).toBeGreaterThan(4096)
      expect(plaintextIn(journal)).toEqual([])
      expect(plaintextIn(join(vault.dir, 'ledger-1.db'))).toEqual([])
    } finally {
      db.exec('ROLLBACK')
    }
    expect(db.prepare('SELECT name FROM accounts').pluck().get()).toBe(
      MARKERS[2],
    )
  })

  it('vault.json holds no fake data and no key in clear', () => {
    const text = readFileSync(join(vault.dir, 'vault.json'), 'utf8')
    for (const marker of MARKERS) expect(text).not.toContain(marker)
    expect(Object.keys(JSON.parse(text)).sort()).toEqual([
      'generation',
      'kdf',
      'key',
      'version',
    ])
  })
})
