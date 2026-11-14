// Migrating an existing ledger: rows survive every schema version's path to
// the current one, and a migration that fails leaves the file as it was.
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BEFORE_MIGRATION, openDatabase } from '../../src/main/vault/database'
import type { Db } from '../../src/main/vault/database'
import { deriveHere } from '../../src/main/vault/kdf'
import { migrations } from '../../src/main/vault/migrations'
import type { Migration } from '../../src/main/vault/migrations'
import { Vault } from '../../src/main/vault/vault'
import { breakReferences, corruptIndex } from '../support/corrupt'
import { PASSWORD } from '../support/vault'
import { tempDirs } from '../support/temp-dir'

const KEY = Buffer.alloc(32, 0xab)
const newDir = tempDirs('ledger-migrate-')
let dir: string
let file: string
beforeEach(() => {
  dir = newDir()
  file = join(dir, 'ledger.db')
})

const sha256 = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const count = (db: Db, table: string) =>
  db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number

/**
 * Rows in every table of the first schema version, in columns it had, and
 * one in each table a later version up to `version` added.
 */
function seed(db: Db, version: number): void {
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
  if (version >= 3)
    db.exec(
      "INSERT INTO import_mappings (signature, mapping) VALUES ('fake signature', '{}')",
    )
  if (version >= 4)
    db.exec("INSERT INTO rule_dismissals (key) VALUES ('fake payee')")
  if (version >= 5)
    db.exec(
      "INSERT INTO transfer_links (out_id, in_id, status) VALUES (2, 3, 'confirmed')",
    )
  if (version >= 7)
    db.exec("INSERT INTO settings (key, value) VALUES ('homeCurrency', 'AUD')")
}

/** Every row of every table, by table. */
function contents(db: Db): Record<string, object[]> {
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
    .pluck()
    .all() as string[]
  return Object.fromEntries(
    tables.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as object[],
    ]),
  )
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
function ledgerAt(version: number): Record<string, object[]> {
  const db = openDatabase(file, KEY, {
    create: true,
    migrations: migrations.slice(0, version),
  })
  seed(db, version)
  const rows = contents(db)
  db.close()
  return rows
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
      const before = ledgerAt(version)
      const db = openDatabase(file, KEY)
      try {
        expect(db.pragma('user_version', { simple: true })).toBe(
          migrations.length,
        )
        // Every value of every row, but in columns later versions added.
        const after = contents(db)
        for (const [table, rows] of Object.entries(before)) {
          expect(after[table], table).toEqual(
            rows.map((row) => expect.objectContaining(row)),
          )
        }
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
    const counts = (of: Db) =>
      ['accounts', 'categories', 'transactions'].map((table) =>
        count(of, table),
      )
    const rows = counts(db)
    expect(rows).toEqual([1, 1, 1])
    vault.lock()
    expect(readdirSync(join(root, 'vault')).sort()).toEqual([
      'ledger-1.db',
      'vault.json',
    ])
    // Migrated from schema 7, with its rows.
    expect(migrations.length).toBeGreaterThan(7)
    expect(readFileSync(join(root, 'vault', 'ledger-1.db'))).not.toEqual(before)
    const again = new Vault(root, { derive: deriveHere })
    expect(await again.unlock(PASSWORD)).toEqual({ ok: true })
    expect(counts(again.database())).toEqual(rows)
    expect(count(again.database(), 'import_skips')).toBe(0)
    again.lock()
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

  it('still opens the ledger when its copy cannot be removed, and logs it', () => {
    ledgerAt(migrations.length)
    const copy = `${file}${BEFORE_MIGRATION}`
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const db = openDatabase(file, KEY, {
        migrations: [
          ...migrations,
          (db) => {
            // A directory in the copy's place is not removed as a file is.
            rmSync(copy)
            mkdirSync(copy)
            db.exec('CREATE TABLE fake_added (id INTEGER PRIMARY KEY) STRICT')
          },
        ],
      })
      expect(count(db, 'fake_added')).toBe(0)
      db.close()
      expect(log).toHaveBeenCalledTimes(1)
      expect(log.mock.calls[0]?.[0]).toMatch(
        /^removing the copy kept for the migration failed: /,
      )
    } finally {
      log.mockRestore()
    }
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

// A ledger the first release opened must still open: what was wrong before
// a migration is not held against it, what the migration adds is.
describe('a ledger that was inconsistent before a migration', () => {
  const addTable: Migration = (db) =>
    db.exec('CREATE TABLE fake_added (id INTEGER PRIMARY KEY) STRICT')
  const version = (db: Db) => db.pragma('user_version', { simple: true })
  const logged = () => vi.spyOn(console, 'error').mockImplementation(() => {})
  afterEach(() => vi.restoreAllMocks())

  it('is migrated with an index that does not match its table, and logged', () => {
    ledgerAt(migrations.length)
    corruptIndex(file, KEY)
    const log = logged()
    const db = openDatabase(file, KEY, {
      migrations: [...migrations, addTable],
    })
    expect(version(db)).toBe(migrations.length + 1)
    expect(count(db, 'transactions')).toBe(3)
    expect(db.pragma('integrity_check', { simple: true })).not.toBe('ok')
    db.close()
    expect(readdirSync(dir)).toEqual(['ledger.db'])
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('is migrated with rows that refer to missing ones', () => {
    ledgerAt(migrations.length)
    breakReferences(file, KEY)
    logged()
    const db = openDatabase(file, KEY, {
      migrations: [...migrations, addTable],
    })
    expect(version(db)).toBe(migrations.length + 1)
    db.close()
    expect(readdirSync(dir)).toEqual(['ledger.db'])
  })

  it('is put back when the migration leaves more rows referring to missing ones', () => {
    ledgerAt(migrations.length)
    breakReferences(file, KEY)
    const before = sha256(file)
    expect(() =>
      openDatabase(file, KEY, {
        migrations: [...migrations, (db) => db.exec('DELETE FROM accounts')],
      }),
    ).toThrow('refer to missing')
    expect(sha256(file)).toBe(before)
    expect(readdirSync(dir)).toEqual(['ledger.db'])
  })

  it('that passed integrity_check is put back when the migration breaks an index', () => {
    ledgerAt(migrations.length)
    breakReferences(file, KEY)
    const before = sha256(file)
    logged()
    // An index dropped from the schema while its rows change, as
    // corruptIndex does, here by the migration itself.
    const breakIndex: Migration = (db) => {
      db.unsafeMode(true)
      db.pragma('writable_schema = ON')
      db.exec(
        'CREATE TABLE fake (n INTEGER); CREATE INDEX fake_n ON fake (n); INSERT INTO fake VALUES (1), (2), (3)',
      )
      const index = db
        .prepare(
          "SELECT rootpage, sql FROM sqlite_schema WHERE name = 'fake_n'",
        )
        .get()
      db.prepare("DELETE FROM sqlite_schema WHERE name = 'fake_n'").run()
      db.pragma('writable_schema = RESET')
      db.pragma('writable_schema = ON')
      db.exec('UPDATE fake SET n = n + 10')
      db.prepare(
        "INSERT INTO sqlite_schema VALUES ('index', 'fake_n', 'fake', @rootpage, @sql)",
      ).run(index)
      db.pragma('writable_schema = RESET')
      db.unsafeMode(false)
    }
    expect(() =>
      openDatabase(file, KEY, { migrations: [...migrations, breakIndex] }),
    ).toThrow('failed its checks')
    expect(sha256(file)).toBe(before)
    expect(readdirSync(dir)).toEqual(['ledger.db'])
  })

  it('says nothing of a ledger that was whole', () => {
    ledgerAt(migrations.length)
    const log = logged()
    openDatabase(file, KEY, { migrations: [...migrations, addTable] }).close()
    expect(log).not.toHaveBeenCalled()
  })
})
