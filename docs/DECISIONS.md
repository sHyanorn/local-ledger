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
- Decision: `--self-test` moves the user data directory to a new temporary directory before the app is ready, waits for the window to render from `app://`, then creates, locks and unlocks a vault there with a throwaway password, which runs the key derivation worker and the bundled SQLCipher module. It prints each step without key material and exits 0 or 1. The package check fails if the default user data directory changes during a self-test
- Rationale: the packaged app refuses the debugging entry points every test driver uses, so a check inside the app is the only way to show that it starts with its fuses, ASAR integrity and signature, and loads its native module from `app.asar.unpacked`. The same path runs unpackaged in CI on all three platforms
- Trade-off: a switch in the shipped app that anyone can pass; it only opens a window and a temporary database, and exits

## D013 Sealed data key and database generations
- Date: 2026-11-08
- Decision: the database is encrypted with a random 32-byte data key. Argon2id derives a key from the master password that seals the data key with AES-256-GCM; the authenticated header binds the generation and KDF settings. `vault/vault.json` holds the header and the sealed key and names the current database, `vault/ledger-<generation>.db`. The data key reaches SQLite as a raw SQLCipher v4 key through a wiped buffer, so no second KDF runs and no string holds it
- Create: the vault is built in a staging directory and renamed into place, so a crash leaves no vault or a whole one
- Password change: a new data key under the new password; the database is copied, the copy re-encrypted (`rekey`), checked with `integrity_check`, flushed and renamed to the next generation; renaming the new `vault.json` over the old one is the single commit point. After a failure without a crash, the vault reopens the generation that `vault.json` on disk names: before the commit the page reports the failure, after it the change stands. The original file is never rekeyed in place, because SQLite3 Multiple Ciphers does not document what a crash mid-rekey leaves
- Recovery: files of other generations and temporary files are removed only after the current generation opens and passes `quick_check` and a directory flush succeeds, one by one, and a file that cannot be removed waits for the next unlock. A missing or invalid `vault.json`, a missing current database, or one that is empty or fails `quick_check` makes the vault "damaged": nothing is deleted and the user is asked to restore from a backup. The checks run before migrations, so a damaged file is never written
- Database settings: rollback journal (`journal_mode=DELETE`), so a copy of one file is the whole database; `synchronous=FULL` and `fullfsync` (macOS); foreign keys on; `temp_store=MEMORY`, so no temporary file holds plaintext; STRICT tables
- Rationale: a wrong password fails the GCM check before the database is touched, which tells it apart from a damaged database, and the structure leaves room for a recovery key
- Trade-off: a password change rewrites the whole database; at personal-finance sizes this takes milliseconds (20,000 rows in 7 ms)

## D014 Master password rules
- Date: 2026-11-08
- Decision: at least 15 and at most 1,024 code points after NFKC normalization; no composition rules and no strength meter. The password is NFKC-normalized before it is encoded, so the same text typed on any keyboard gives the same key. Unlocking checks only the upper bound, so raising the minimum never locks anyone out. Unlocking has no attempt limit
- Rationale: offline guessing against a copied vault is the main threat, and NIST SP 800-63B-4 asks for 15 characters for a password used as a single factor. An attempt limit cannot stop an attacker who copies the files; the Argon2id cost does the work
- Setup says once, next to the button, that a forgotten password cannot be recovered; the placeholder suggests a sentence

## D015 Key derivation
- Date: 2026-11-08
- Decision: Argon2id from `hash-wasm` 4.13.0 (MIT, no dependencies, WebAssembly) with m=64 MiB, t=3, p=4 (RFC 9106, second recommended option), a 16-byte salt and a 32-byte key. It runs in a worker thread, which ends after each derivation. `vault.json` may ask for 19 MiB to 1 GiB, 1 to 10 passes and 1 to 16 lanes, nothing outside
- Measured (Electron 45, 2.1 GHz Xeon, 4 cores): 321 ms to derive, 329 ms to unlock. On the main thread the derivation blocked the event loop for 281 ms; in the worker, 7 ms
- Alternatives: the native `argon2` package is four times faster but has no darwin-x64 or win32-arm64 prebuild and runs an install script; Node's `crypto.argon2` exists in Electron 45 but fails, since BoringSSL lacks Argon2
- Check: unit tests pin vectors computed with hash-wasm and the reference C implementation (node-argon2 0.45.2); 4.12.0 and 4.13.0 give identical output

## D016 Locking replaces the page process
- Date: 2026-11-08
- Decision: the window hosts its page in a `WebContentsView`. On every unlock, lock and password change the main process loads the page in a new view and closes the old one, whose renderer process then exits, so no renderer process that held a typed password or decrypted data outlives the change. A lock replaces the page even when the vault is already locked, so a password typed but not submitted does not survive it. Closing the window closes its view too, since a `BaseWindow` leaves its views running. Locking closes the database at once and cancels vault operations still deriving a key. The vault locks after 5 minutes of system idle time, when the operating system locks the screen or suspends, on Cmd/Ctrl+L, and when the window closes
- Rationale: clearing a store cannot wipe what JavaScript strings and the DOM held; ending the process can. Two views of the same origin get separate processes; the e2e suite asserts that the old process has exited
- Later: the idle limit becomes a setting in M5
