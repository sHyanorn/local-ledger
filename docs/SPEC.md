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
  - User rules: if the description contains, starts with or is some text, assign it to a category
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
│  vault: password → Argon2id → sealed DB key  │
│  db: SQLCipher-compatible encrypted SQLite   │
│  import / export / rules / backup            │
└──────────────────────────────────────────────┘
```

Encryption scheme:

- The whole database is encrypted with `better-sqlite3-multiple-ciphers` (SQLCipher v4 scheme) under a random 32-byte data key
- A key derived from the master password with Argon2id seals the data key (AES-256-GCM); `vault.json` holds the salt, the Argon2id parameters and the sealed key, in plaintext
- Changing the master password draws a new data key and re-encrypts the database into a new file; replacing `vault.json` commits the change (D013)
- A backup file is the encrypted database itself plus version information
- Details and limits: `docs/SECURITY_DESIGN.md`

## 5. Data model

```
accounts(id, name, type, currency, opening_balance_cents, created_at)
transactions(id, account_id, date, amount_cents, description, category_id,
             import_batch_id, hash, notes, edited, created_at)
categories(id, name, parent_id, color, icon)
rules(id, pattern, match_type, category_id, priority)
rule_dismissals(key)
budgets(id, category_id, month, amount_cents)
import_batches(id, file_name, row_count, imported_at)
import_mappings(signature, mapping)
transfer_links(out_id, in_id, status)
report_transactions: transactions minus both sides of confirmed transfers
```

All amounts are stored as integers (cents). An imported transaction's `hash` is its fingerprint (D025); `edited` marks a change by the user. Rules match by "contains", "starts with" or "is" (D026). Transfers are pairs of transactions (D027).

## 6. Interface

- Sidebar: Overview, Transactions, Transfers (pairs to review), Budgets, Reports, Settings
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
