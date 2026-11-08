# Tasks

## M0 Setup
- [x] Scaffold a React + TypeScript project with electron-vite and add Zustand
- [x] Configure oxlint, Prettier, Vitest and Playwright
- [x] Apply the Electron security configuration from CLAUDE.md and write tests for it
- [x] Open an encrypted database under Electron on Ubuntu, Windows and macOS; package Windows and macOS and check the result
- [x] CI: lint, type check, unit tests, e2e tests and the native checks

## M1 Encrypted storage
- [x] Argon2id key derivation and parameter configuration
- [x] Open the encrypted database, create tables, run migrations
- [x] First-run password setup and unlock screen
- [x] Idle auto-lock
- [x] Change the master password
- [x] Encryption tests
- [x] Keep keys in Buffers and zero them after use; state in `docs/SECURITY_DESIGN.md` what cannot be wiped (the master password arrives over IPC as a string)

## M2 Data core
- [x] Typed IPC API with zod validation
- [x] CRUD for accounts and categories
- [x] Transaction list, search, filtering and editing; extend the lock test to check that no fake transaction text survives a lock
- [x] `npm run seed` fake data generator

## M3 Import and categorization
- [x] CSV parsing and generic column-mapping wizard
- [x] Templates for the four Australian banks (tested with hand-made sample files)
- [ ] Check the bank templates against `npm run csv:shape` output from real exports
- [x] Import preview and duplicate detection
- [x] Rule engine and "create a rule after a manual change" prompt
- [x] Deleting a category that rules point to: say how many, and what happens to them
- [x] Transfers: when both accounts' CSVs are imported, one transfer appears twice (out of one, into the other); detect the pair and keep it out of M4's income and spending

## M4 Budgets and reports
- [ ] Budget setup and overspending alerts
- [ ] Overview and report charts, reading income and spending from `report_transactions` so paired transfers stay out (D027)
- [ ] Excel and PDF export, preferring options with few dependencies; text cells written as text, and any CSV export escaping cells that start with `=`, `+`, `-`, `@`, a tab or a line break, full-width forms included (SECURITY_DESIGN)

## M5 Polish and release
- [ ] Apple-style UI polish, dark mode, keyboard shortcuts; a setting for the auto-lock time; dropping a CSV file on the window to import it
- [ ] Encrypted backup and restore
- [ ] Release workflow: macOS and Windows installers, checksums and provenance attestation (D006)
- [ ] Playwright end-to-end tests
- [ ] Complete `docs/SECURITY_DESIGN.md`
- [ ] English README, screenshots and GIFs; publish the first release

## Nice to have
- [ ] Archive an account: hide it from lists while keeping its transactions
- [ ] Recovery key: a random key, shown once at setup, that also seals the data key (D013 leaves room for it)
