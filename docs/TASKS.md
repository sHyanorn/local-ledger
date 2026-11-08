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
- [x] Cross-check the bank templates with public sample files; state that they are unverified against real exports (D024)
- [x] Import preview and duplicate detection
- [x] Rule engine and "create a rule after a manual change" prompt
- [x] Deleting a category that rules point to: say how many, and what happens to them
- [x] Transfers: when both accounts' CSVs are imported, one transfer appears twice (out of one, into the other); detect the pair and keep it out of M4's income and spending

## M4 Budgets and reports
- [x] Budget setup and overspending alerts
- [x] Overview and report charts, reading income and spending from `report_transactions` so paired transfers stay out (D027)
- [x] Excel and PDF export, preferring options with few dependencies; text cells written as text, and any CSV export escaping cells that start with `=`, `+`, `-`, `@`, a tab or a line break, full-width forms included (SECURITY_DESIGN)

## M5 Polish and release
- [x] Apple-style UI polish, dark mode, keyboard shortcuts; a setting for the auto-lock time; dropping a CSV file on the window to import it (D032, D036, D037)
- [x] Import preview at the 50,000-row limit: it took about 4 s to show and up to 1 s per checkbox; now about 0.2 s and 15 ms (D035)
- [x] Delimiter detection: a two-line tab-separated file with comma thousands separators was read as comma-separated, and a semicolon file with unquoted semicolons in descriptions split wrongly
- [x] A home-currency setting for budgets (D028, D032)
- [x] Encrypted backup and restore (D033, D034)
- [ ] Release workflow: macOS and Windows installers, checksums and provenance attestation (D006)
- [x] Playwright end-to-end tests, including the whole flow from setting a password to exporting
- [x] Complete `docs/SECURITY_DESIGN.md`
- [ ] English README, screenshots and GIFs; publish the first release

## Nice to have
- [ ] Open an exported workbook in Excel and Numbers, which have not been tried (D030); and see the sidebar vibrancy on a real Mac (D037)
- [ ] Check the bank layouts against real exports, should any become available (D024): every check so far used public, made-up samples
- [ ] Archive an account: hide it from lists while keeping its transactions
- [ ] Recovery key: a random key, shown once at setup, that also seals the data key (D013 leaves room for it)
