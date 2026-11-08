# local-ledger Specification

## 1. One-line summary

A personal finance desktop app whose data stays on the local machine in a fully encrypted database: import bank CSVs, categorize automatically, set budgets, view monthly charts, and export to Excel and PDF.

## 2. Components

| Component | Contents |
|---|---|
| Desktop shell | Electron main, preload and renderer processes, typed IPC, native menus, macOS and Windows packaging |
| Security | Whole-database encryption, Argon2id key derivation, Electron hardening, auto-lock |
| Interface | React + Zustand, macOS-style design, dark mode, keyboard shortcuts |
| Data processing | CSV parsing and column mapping, deduplication, rule-based categorization, export |

## 3. Scope

### Must have

- Set a master password on first launch; unlock on every launch after that
- Account management: multiple bank or cash accounts
- CSV import
  - Built-in templates for common Australian bank formats (CommBank, NAB, ANZ, Westpac), plus a generic column-mapping wizard
  - Date and amount format detection, with a preview before import
  - Duplicate transaction detection (fuzzy matching on date, amount and description)
- Automatic categorization
  - User rules: if the description contains a keyword, assign it to a category
  - When the user changes a category manually, offer to create a new rule
- Budgets: monthly budgets per category, with overspending alerts
- Charts: monthly income and expenses, category breakdown, trends
- Search and filtering
- Export: monthly reports in Excel and PDF
- Auto-lock when idle
- Encrypted backup and restore
- Dark mode

### Nice to have

- Multiple currencies (AUD, CNY), with manually entered exchange rates
- Local machine-learning categorization (naive Bayes, fully offline)
- Update notice: a menu item that opens the GitHub Releases page

### Out of scope

- Cloud sync
- Bank API connections

## 4. Architecture

```
┌───────── Renderer process (sandbox) ─────────┐
│ React + Zustand                              │
│ window.ledger.* (typed API from preload)     │
└───────────────────┬──────────────────────────┘
                    │ IPC (zod-validated)
┌───────────────────▼──────────────────────────┐
│ Main process                                 │
│  vault: master password → Argon2id → DB key  │
│  db: SQLCipher-compatible encrypted SQLite   │
│  import / export / rules / backup            │
└──────────────────────────────────────────────┘
```

Encryption scheme:

- The whole database is encrypted with `better-sqlite3-multiple-ciphers` (SQLCipher-compatible)
- The database key is derived from the master password and a random salt with Argon2id; the salt and parameters are stored in a separate plaintext config file
- Changing the master password re-encrypts the database
- A backup file is the encrypted database itself plus version information

## 5. Data model

```
accounts(id, name, type, currency, created_at)
transactions(id, account_id, date, amount_cents, description, category_id,
             import_batch_id, hash, notes, created_at)
categories(id, name, parent_id, color, icon)
rules(id, pattern, match_type, category_id, priority)
budgets(id, category_id, month, amount_cents)
import_batches(id, file_name, row_count, imported_at)
```

All amounts are stored as integers (cents).

## 6. Interface

- Sidebar: Overview, Transactions, Budgets, Reports, Settings
- Overview: this month's income and expense cards, budget progress, recent transactions
- Style: modeled on native macOS apps, with the system font, a translucent sidebar, subtle animations and keyboard shortcuts
- All demo screenshots use fake data

## 7. Testing strategy

- Unit tests: CSV parsing (sample files for each bank), deduplication, rule matching, amount calculations
- Security tests: the renderer cannot access `require` or `process`; invalid IPC arguments are rejected; data is unreadable after locking
- Encryption tests: the database file cannot be opened with plain SQLite; a wrong password cannot unlock it
- End-to-end tests: the full flow of setting a password, importing, categorizing, budgeting and exporting

## 8. Deliverables

- macOS and Windows installers (GitHub Releases), unsigned (D006), with SHA-256 checksums and a build provenance attestation
- English README: screenshots, GIFs, security design notes, download links, first-launch steps on each platform, and how to verify a download
- `docs/SECURITY_DESIGN.md`: Electron hardening checklist and encryption scheme
