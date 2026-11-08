# Tasks

## M0 Setup
- [x] Scaffold a React + TypeScript project with electron-vite and add Zustand
- [x] Configure oxlint, Prettier, Vitest and Playwright
- [x] Apply the Electron security configuration from CLAUDE.md and write tests for it
- [x] Open an encrypted database under Electron on Ubuntu, Windows and macOS; package Windows and macOS and check the result
- [x] CI: lint, type check, unit tests, e2e tests and the native checks

## M1 Encrypted storage
- [ ] Argon2id key derivation and parameter configuration
- [ ] Open the encrypted database, create tables, run migrations
- [ ] First-run password setup and unlock screen
- [ ] Idle auto-lock
- [ ] Change the master password
- [ ] Encryption tests
- [ ] Keep keys in Buffers and zero them after use; state in the plan and in `docs/SECURITY_DESIGN.md` what cannot be wiped (the master password arrives over IPC as a string, and the key reaches SQLite as a hex string)

## M2 Data core
- [ ] Typed IPC API with zod validation
- [ ] CRUD for accounts and categories
- [ ] Transaction list, search, filtering and editing
- [ ] `npm run seed` fake data generator

## M3 Import and categorization
- [ ] CSV parsing and generic column-mapping wizard
- [ ] Templates for the four Australian banks (tested with hand-made sample files)
- [ ] Import preview and duplicate detection
- [ ] Rule engine and "create a rule after a manual change" prompt

## M4 Budgets and reports
- [ ] Budget setup and overspending alerts
- [ ] Overview and report charts
- [ ] Excel and PDF export, preferring options with few dependencies

## M5 Polish and release
- [ ] Apple-style UI polish, dark mode, keyboard shortcuts
- [ ] Encrypted backup and restore
- [ ] Release workflow: macOS and Windows installers, checksums and provenance attestation (D006)
- [ ] Playwright end-to-end tests
- [ ] Write `docs/SECURITY_DESIGN.md`
- [ ] English README, screenshots and GIFs; publish the first release
