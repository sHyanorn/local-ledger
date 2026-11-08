# Technical Decisions

## D001 Electron + React + TypeScript + Zustand
- Date: 2026-11-04
- Rationale: matches an already familiar stack and covers desktop security practices end to end
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
- Rationale: local-first is the product's defining property and reduces the attack surface

## D005 oxlint instead of ESLint
- Date: 2026-11-06
- Rationale: the same linter as vault-share (its D006), so the frontends of these projects share one lint setup; oxlint is the default of the current `create-vite` template

## D006 Unsigned releases without auto-update
- Date: 2026-11-08
- Decision: releases are not code signed or notarized. The macOS app is ad-hoc signed so it runs on Apple Silicon; the Windows NSIS installer is unsigned. There is no auto-update: a "Check for Updates…" menu item opens the GitHub Releases page in the browser, so the app makes no network requests. Each release ships SHA-256 checksums and a GitHub build provenance attestation
- First launch: macOS blocks the app until the user allows it under System Settings → Privacy & Security → Open Anyway; Windows SmartScreen needs More info → Run anyway, and Smart App Control, when on, blocks unsigned apps with no per-app override. The README documents both
- Rationale: notarization needs a paid Apple Developer Program membership, and Squirrel.Mac only updates signed apps; an updater without a verified publisher would run whatever the release feed points to
- Revisit: with a Developer ID certificate or a free open-source signing service, sign both platforms and reconsider electron-updater

## D007 Toolchain and dependencies
- Date: 2026-11-08
- Decision: Electron 45 with electron-vite 6 (Vite 8), React 19, Zustand 5, TypeScript 7, oxlint, Prettier, Vitest 5 and Playwright. Node 24 for development and CI, the major that Electron 45 embeds; `@types/node` follows it. electron-builder and `@electron/fuses` arrive in M0 because M0 checks packaging: the first builds the app, the second reads its fuses back. electron-builder is 26.18.1, which renames Electron 45's `electron_wer.dll` with the executable; 26.18.0 does not
- Fallback: TypeScript 7 has no JavaScript compiler API. If `tsc -b` misbehaves or a needed tool depends on that API, pin 6.0.3
- Left out: `@electron-toolkit/preload` and `@electron-toolkit/utils` from the electron-vite template; the first exposes a wrapper of `ipcRenderer` to the page
- Note: React and Zustand are dev dependencies because Vite bundles them; electron-builder packs only `dependencies`

## D008 Native modules without rebuilding
- Date: 2026-11-08
- Decision: better-sqlite3-multiple-ciphers 13 is a Node-API addon with prebuilds for macOS, Windows and Linux. Node-API is stable across Node and Electron, so nothing is rebuilt for Electron (`npmRebuild: false`). The package keeps only the target's binary, unpacked next to `app.asar`; its sources and the other prebuilds are filtered out. `.npmrc` sets `ignore-scripts=true` as vault-share does, and `npm run setup:electron` fetches the Electron binary that a postinstall script would
- Check: CI runs the self-test (D012) of the built app on Ubuntu, Windows and macOS, then packages Windows and macOS and runs `tests/native/check-package.mjs` on the result
- Note: the package's `exports` map has no `types` condition, so the tsconfig files map its name to `index.d.ts`

## D009 Renderer on a custom scheme with a CSP header
- Date: 2026-11-08
- Decision: the renderer build is served from `app://local-ledger`, registered as standard and secure before the app is ready. The handler answers GET only, accepts only the characters the build output uses, refuses Windows device names, and refuses any path outside the build directory. Every response, errors included, carries the CSP: `default-src 'none'`, scripts, styles, fonts and connections from `'self'` only, images also from `data:`. The page has no CSP meta tag, because the header covers every response and a meta tag cannot carry `frame-ancestors`. `grantFileProtocolExtraPrivileges` is off, since nothing loads from `file://`
- Also: new windows, navigation, redirects and webviews are refused. Each session is hardened when it is created: every permission request and check is denied, requests outside the app are cancelled, and spellcheck is off with no language, because Chromium otherwise downloads a dictionary from its CDN at startup. The e2e suite and the package check read a Chromium net log and fail on any network request
- Development: pages from the Vite dev server carry no CSP. The e2e tests run the built app and fail on any CSP violation or console error during load
- Rationale: Electron's security checklist (items 1 to 20, v45 docs); Actual Budget serves its renderer from `app://` the same way

## D010 The Chromium sandbox stays on
- Date: 2026-11-08
- Decision: the main process exits at start when a switch in `src/main/switches.json` that turns the sandbox off, wholly or for some processes, is present. When packaged it also refuses the remote debugging switches, which would let another process drive the window over the DevTools protocol; the unpackaged build keeps them for Playwright. Playwright disables the sandbox for Electron on Linux unless `chromiumSandbox: true` is passed, so the e2e fixture passes it, and the suite asserts the sandbox at the OS level: seccomp and a separate user namespace on Linux, the `sandboxed` process metric elsewhere. CI lifts Ubuntu's user namespace restriction rather than disable the sandbox, and `npm run lint` fails on any file that uses a switch from the list
- Note: Chromium refuses to start as root with the sandbox on, so local e2e runs need a non-root user. On Linux it also aborts by itself when the namespace sandbox is turned off and no setuid sandbox is installed

## D011 Supply chain pinning
- Date: 2026-11-08
- Decision: as vault-share D011. npm dependencies at exact versions, GitHub Actions at commit SHAs of their latest major, runner images by name (ubuntu-24.04, windows-2025, macos-15), Dependabot weekly for npm and Actions, and `npm audit --audit-level=high` in CI
- Known: `npm audit` reports a moderate ReDoS advisory for minimatch, which electron-builder uses at build time only

## D012 Self-test switch
- Date: 2026-11-08
- Decision: `--self-test` waits for the window to render from `app://`, opens a throwaway encrypted database with a random key through the bundled SQLCipher module, prints each step without key material, and exits 0 or 1
- Rationale: the packaged app refuses the debugging entry points every test driver uses, so a check inside the app is the only way to show that it starts with its fuses, ASAR integrity and signature, and loads its native module from `app.asar.unpacked`. The same path runs unpackaged in CI on all three platforms
- Trade-off: a switch in the shipped app that anyone can pass; it only opens a window and a temporary database, and exits
