// Migrating an existing ledger: rows survive every schema version's path to
// the current one, and a migration that fails leaves the file as it was.
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BEFORE_MIGRATION, openDatabase } from '../../src/main/vault/database'
import type { Db } from '../../src/main/vault/database'
import { deriveHere } from '../../src/main/vault/kdf'
import { migrations } from '../../src/main/vault/migrations'
import type { Migration } from '../../src/main/vault/migrations'
import { Vault } from '../../src/main/vault/vault'
import { PASSWORD } from '../support/vault'

const KEY = Buffer.alloc(32, 0xab)
let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-migrate-'))
  file = join(dir, 'ledger.db')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const sha256 = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const count = (db: Db, table: string) =>
  db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number

/** Rows in every table of the first schema version, in columns it had. */
function seed(db: Db): void {
  db.exec(`
    INSERT INTO accounts (id, name, type, currency) VALUES
      (1, 'Fake Everyday', 'bank', 'AUD'), (2, 'Fake Savings', 'bank', 'AUD');
    INSERT INTO categories (id, name, parent_id) VALUES
      (1, 'Fake Food', NULL), (2, 'Fake Cafes', 1);
    INSERT INTO import_batches (id, file_name, row_count) VALUES (1, 'fake.csv', 2);
    INSERT INTO transactions
      (id, account_id, date, amount_cents, description, category_id, import_batch_id, hash)
    VALUES
      (1, 1, '2026-05-01', -450, 'Fake Cafe', 2, 1, 'fake-hash-1'),
      (2, 1, '2026-05-02', -20000, 'Fake Transfer', NULL, 1, 'fake-hash-2'),
      (3, 2, '2026-05-02', 20000, 'Fake Transfer', NULL, NULL, NULL);
    INSERT INTO rules (pattern, match_type, category_id) VALUES ('fake cafe', 'contains', 2);
    INSERT INTO budgets (category_id, month, amount_cents) VALUES (1, '2026-05', 30000);
  `)
}
const TABLES = [
  ['accounts', 2],
  ['categories', 2],
  ['import_batches', 1],
  ['transactions', 3],
  ['rules', 1],
  ['budgets', 1],
] as const

/** A ledger at schema version `version`, holding the seed rows, closed. */
function ledgerAt(version: number): void {
  const db = openDatabase(file, KEY, {
    create: true,
    migrations: migrations.slice(0, version),
  })
  seed(db)
  db.close()
}

// The table rebuild of the SQLite documentation, on a table others refer to.
const rebuildCategories: Migration = (db) =>
  db.exec(`
    CREATE TABLE categories_new (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
      color TEXT,
      icon TEXT,
      note TEXT
    ) STRICT;
    INSERT INTO categories_new
      SELECT id, name, parent_id, color, icon, NULL FROM categories;
    DROP TABLE categories;
    ALTER TABLE categories_new RENAME TO categories;
    CREATE UNIQUE INDEX categories_name
      ON categories (ifnull(parent_id, 0), name COLLATE NOCASE);
  `)

describe('migrating from each earlier schema version', () => {
  for (let version = 1; version < migrations.length; version++) {
    it(`keeps every row from version ${version}`, () => {
      ledgerAt(version)
      const db = openDatabase(file, KEY)
      try {
        expect(db.pragma('user_version', { simple: true })).toBe(
          migrations.length,
        )
        for (const [table, rows] of TABLES) {
          expect(count(db, table), table).toBe(rows)
        }
        expect(
          db
            .prepare(
              'SELECT account_id, sum(amount_cents) FROM transactions GROUP BY account_id ORDER BY account_id',
            )
            .raw()
            .all(),
        ).toEqual([
          [1, -20450],
          [2, 20000],
        ])
        expect(
          db
            .prepare(
              'SELECT category_id, import_batch_id, hash FROM transactions WHERE id = 1',
            )
            .get(),
        ).toEqual({ category_id: 2, import_batch_id: 1, hash: 'fake-hash-1' })
        expect(db.pragma('foreign_key_check')).toEqual([])
        expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
        expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
      } finally {
        db.close()
      }
      expect(readdirSync(dir)).toEqual(['ledger.db'])
    })
  }

  it('opens the vault of the first release with its rows', async () => {
    const root = join(dir, 'user-data')
    cpSync(join(__dirname, '../fixtures/vault-v1/vault'), join(root, 'vault'), {
      recursive: true,
    })
    const before = readFileSync(join(root, 'vault', 'ledger-1.db'))
    const vault = new Vault(root, { derive: deriveHere })
    expect(await vault.unlock(PASSWORD)).toEqual({ ok: true })
    const db = vault.database()
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
    expect(count(db, 'accounts')).toBeGreaterThan(0)
    expect(count(db, 'transactions')).toBeGreaterThan(0)
    vault.lock()
    expect(readdirSync(join(root, 'vault')).sort()).toEqual([
      'ledger-1.db',
      'vault.json',
    ])
    // Until a later schema version exists, nothing is rewritten.
    if (migrations.length === 7)
      expect(readFileSync(join(root, 'vault', 'ledger-1.db'))).toEqual(before)
  })
})

describe('a migration', () => {
  it('that rebuilds a table keeps the rows that refer to it', () => {
    ledgerAt(migrations.length)
    const db = openDatabase(file, KEY, {
      migrations: [...migrations, rebuildCategories],
    })
    try {
      for (const [table, rows] of TABLES) {
        expect(count(db, table), table).toBe(rows)
      }
      expect(
        db.prepare('SELECT category_id FROM transactions WHERE id = 1').get(),
      ).toEqual({ category_id: 2 })
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    } finally {
      db.close()
    }
  })

  it('runs beside a copy of the file as it was, removed once it has passed', () => {
    ledgerAt(migrations.length)
    const before = sha256(file)
    let copy: string | null = null
    const db = openDatabase(file, KEY, {
      migrations: [
        ...migrations,
        (db) => {
          copy = sha256(`${file}${BEFORE_MIGRATION}`)
          db.exec('CREATE TABLE fake_added (id INTEGER PRIMARY KEY) STRICT')
        },
      ],
    })
    db.close()
    expect(copy).toBe(before)
    expect(readdirSync(dir)).toEqual(['ledger.db'])
    expect(sha256(file)).not.toBe(before)
  })

  it('that fails leaves the file as it was, also after earlier ones passed', () => {
    ledgerAt(migrations.length)
    const before = sha256(file)
    expect(() =>
      openDatabase(file, KEY, {
        migrations: [
          ...migrations,
          (db) => db.exec('DELETE FROM budgets'),
          () => {
            throw new Error('fake failure')
          },
        ],
      }),
    ).toThrow('fake failure')
    expect(sha256(file)).toBe(before)
    expect(readdirSync(dir)).toEqual(['ledger.db'])
    const db = openDatabase(file, KEY)
    expect(count(db, 'budgets')).toBe(1)
    db.close()
  })

  it('that leaves a row referring to a missing one is undone', () => {
    ledgerAt(migrations.length)
    const before = sha256(file)
    expect(() =>
      openDatabase(file, KEY, {
        migrations: [...migrations, (db) => db.exec('DELETE FROM categories')],
      }),
    ).toThrow('refer to missing')
    expect(sha256(file)).toBe(before)
    expect(existsSync(`${file}${BEFORE_MIGRATION}`)).toBe(false)
  })

  it('of a new ledger keeps no copy', () => {
    let copied = false
    openDatabase(file, KEY, {
      create: true,
      migrations: [
        ...migrations,
        () => {
          copied = existsSync(`${file}${BEFORE_MIGRATION}`)
        },
      ],
    }).close()
    expect(copied).toBe(false)
    expect(readdirSync(dir)).toEqual(['ledger.db'])
  })
})
