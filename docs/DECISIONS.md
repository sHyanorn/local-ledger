# Technical Decisions

## D001 Electron + React + TypeScript + Zustand
- Date: 2026-11-04
- Rationale: matches an already familiar stack and fully showcases desktop security practices
- Alternatives: Tauri (smaller bundle, but requires Rust)

## D002 Whole-database encryption
- Date: 2026-11-04
- Decision: use SQLCipher-compatible encrypted SQLite
- Rationale: simpler and more reliable than per-field encryption; indexes and queries work as usual
- Alternatives: per-field encryption (flexible, but easy to miss a field)

## D003 Store amounts as integer cents
- Date: 2026-11-04
- Rationale: avoids floating-point errors

## D004 No cloud sync
- Date: 2026-11-04
- Rationale: local-first is the product's selling point and reduces the attack surface

## D005 oxlint instead of ESLint
- Date: 2026-11-06
- Rationale: the same linter as vault-share (its D006), so every frontend in the portfolio shares one lint setup; oxlint is the default of the current `create-vite` template
