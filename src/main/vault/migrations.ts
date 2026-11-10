// Schema changes, applied in order; PRAGMA user_version records how many
// have run. Never edit a migration that has shipped: add a new one.
import type Database from 'better-sqlite3-multiple-ciphers'

export type Migration = (db: Database.Database) => void

const ISO_DATE = "GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'"
const ISO_MONTH = "GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'"
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"

export const migrations: readonly Migration[] = [
  // 1: the data model of SPEC section 5. Amounts are integer cents.
  (db) =>
    db.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        currency TEXT NOT NULL CHECK (length(currency) = 3),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      ) STRICT;

      CREATE TABLE categories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
        color TEXT,
        icon TEXT
      ) STRICT;

      CREATE TABLE import_batches (
        id INTEGER PRIMARY KEY,
        file_name TEXT NOT NULL,
        row_count INTEGER NOT NULL CHECK (row_count >= 0),
        imported_at TEXT NOT NULL DEFAULT ${NOW}
      ) STRICT;

      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
        date TEXT NOT NULL CHECK (date ${ISO_DATE}),
        amount_cents INTEGER NOT NULL,
        description TEXT NOT NULL,
        category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
        import_batch_id INTEGER REFERENCES import_batches (id) ON DELETE SET NULL,
        hash TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      ) STRICT;
      CREATE INDEX transactions_account_date ON transactions (account_id, date);
      CREATE INDEX transactions_date ON transactions (date);
      CREATE INDEX transactions_category ON transactions (category_id);
      CREATE INDEX transactions_hash ON transactions (hash);

      CREATE TABLE rules (
        id INTEGER PRIMARY KEY,
        pattern TEXT NOT NULL,
        match_type TEXT NOT NULL,
        category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
        priority INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE TABLE budgets (
        id INTEGER PRIMARY KEY,
        category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
        month TEXT NOT NULL CHECK (month ${ISO_MONTH}),
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        UNIQUE (category_id, month)
      ) STRICT;
    `),

  // 2: opening balances, and names unique where the page shows them side by side.
  (db) =>
    db.exec(`
      ALTER TABLE accounts
        ADD COLUMN opening_balance_cents INTEGER NOT NULL DEFAULT 0;
      CREATE UNIQUE INDEX accounts_name ON accounts (name COLLATE NOCASE);
      CREATE UNIQUE INDEX categories_name
        ON categories (ifnull(parent_id, 0), name COLLATE NOCASE);
    `),

  // 3: CSV import. An imported row's hash is its fingerprint, unique in its
  // account; `edited` marks a row the user changed, for undoing an import.
  (db) =>
    db.exec(`
      DROP INDEX transactions_hash;
      CREATE UNIQUE INDEX transactions_hash
        ON transactions (account_id, hash) WHERE hash IS NOT NULL;
      ALTER TABLE transactions
        ADD COLUMN edited INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1));
      CREATE INDEX transactions_import_batch ON transactions (import_batch_id);

      CREATE TABLE import_mappings (
        signature TEXT PRIMARY KEY,
        mapping TEXT NOT NULL
      ) STRICT;
    `),

  // 4: rules run in priority order; suggestions the user declined stay declined.
  (db) =>
    db.exec(`
      CREATE INDEX rules_priority ON rules (priority, id);
      CREATE TABLE rule_dismissals (key TEXT PRIMARY KEY) STRICT;
    `),

  // 5: transfers between the user's accounts. A confirmed pair is one
  // transfer, kept out of income and spending; a rejected pair is not
  // offered again. Reports read report_transactions.
  (db) =>
    db.exec(`
      CREATE TABLE transfer_links (
        out_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
        in_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('confirmed', 'rejected')),
        PRIMARY KEY (out_id, in_id),
        CHECK (out_id <> in_id)
      ) STRICT;
      CREATE UNIQUE INDEX transfer_links_out
        ON transfer_links (out_id) WHERE status = 'confirmed';
      CREATE UNIQUE INDEX transfer_links_in
        ON transfer_links (in_id) WHERE status = 'confirmed';
      CREATE INDEX transfer_links_in_any ON transfer_links (in_id);
      CREATE INDEX transactions_amount ON transactions (amount_cents, date);

      CREATE VIEW transfer_members AS
        SELECT out_id AS id FROM transfer_links WHERE status = 'confirmed'
        UNION ALL
        SELECT in_id FROM transfer_links WHERE status = 'confirmed';

      CREATE VIEW report_transactions AS
        SELECT * FROM transactions
        WHERE id NOT IN (SELECT id FROM transfer_members);
    `),

  // 6: a budget holds from its month until a later row for the category;
  // a row without an amount ends the budget from that month.
  (db) =>
    db.exec(`
      CREATE TABLE budgets_new (
        id INTEGER PRIMARY KEY,
        category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
        month TEXT NOT NULL CHECK (month ${ISO_MONTH}),
        amount_cents INTEGER CHECK (amount_cents >= 0),
        UNIQUE (category_id, month)
      ) STRICT;
      INSERT INTO budgets_new SELECT id, category_id, month, amount_cents FROM budgets;
      DROP TABLE budgets;
      ALTER TABLE budgets_new RENAME TO budgets;
    `),

  // 7: preferences, one row per key, read with defaults for missing keys.
  (db) =>
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `),
]

export class NewerSchemaError extends Error {
  constructor(version: number) {
    super(`the database has schema version ${version}, newer than this app`)
    this.name = 'NewerSchemaError'
  }
}

/**
 * Runs the migrations the database has not had, each in a transaction of its
 * own with its version number. Foreign keys are off meanwhile, as SQLite's
 * steps for changing a table's schema require: with them on, dropping a
 * table to rebuild it deletes or clears the rows that refer to it. Each
 * migration must leave every reference whole, or it is rolled back.
 */
export function migrate(
  db: Database.Database,
  list: readonly Migration[] = migrations,
): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current > list.length) throw new NewerSchemaError(current)
  if (current === list.length) return
  // No effect inside a transaction, so set around them.
  db.pragma('foreign_keys = OFF')
  try {
    list.slice(current).forEach((migration, index) => {
      db.transaction(() => {
        migration(db)
        if (hasBrokenReferences(db))
          throw new Error('a migration left rows that refer to missing ones')
        db.pragma(`user_version = ${current + index + 1}`)
      })()
    })
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

/** Whether any row refers to one that is not there. */
export const hasBrokenReferences = (db: Database.Database): boolean =>
  (db.pragma('foreign_key_check') as unknown[]).length > 0
