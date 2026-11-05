# Tasks

## M0 Setup
- [ ] Scaffold a React + TypeScript project with electron-vite and add Zustand
- [ ] Configure ESLint, Prettier, Vitest and Playwright
- [ ] Apply the Electron security configuration from CLAUDE.md and write tests for it
- [ ] CI: lint, type check, unit tests

## M1 Encrypted storage
- [ ] Argon2id key derivation and parameter configuration
- [ ] Open the encrypted database, create tables, run migrations
- [ ] First-run password setup and unlock screen
- [ ] Idle auto-lock
- [ ] Change the master password
- [ ] Encryption tests

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
- [ ] Excel and PDF export

## M5 Polish and release
- [ ] Apple-style UI polish, dark mode, keyboard shortcuts
- [ ] Encrypted backup and restore
- [ ] Package for macOS and Windows with electron-builder
- [ ] Playwright end-to-end tests
- [ ] Write `docs/SECURITY_DESIGN.md`
- [ ] English README, screenshots and GIFs; publish the first release
