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
- Decision: the window hosts its page in a `WebContentsView`. On every unlock, lock and committed password change the main process loads the page in a new view and closes the old one, whose renderer process then exits, so no renderer process that held a typed password or decrypted data outlives the change. A change that fails keeps its page to report the failure and clears its fields; the typed passwords stay in that process until the next lock. A lock replaces the page even when the vault is already locked, so a password typed but not submitted does not survive it. Closing the window closes its view too, since a `BaseWindow` leaves its views running. Locking closes the database at once and cancels vault operations still deriving a key. The vault locks after 5 minutes of system idle time, when the operating system locks the screen or suspends, on Cmd/Ctrl+L, and when the window closes
- Rationale: clearing a store cannot wipe what JavaScript strings and the DOM held; ending the process can. Two views of the same origin get separate processes; the e2e suite asserts that the old process has exited
- Later: the idle limit becomes a setting in M5

## D017 Data IPC
- Date: 2026-11-08
- Decision: accounts, categories and transactions each have list, create, update and delete channels; transactions also have paged listing and totals. Every payload is checked in the main process against a schema in `src/shared/schemas.ts`: names up to 100 characters, descriptions 500, notes 2,000, searches 200; amounts are integers within ±10¹¹ units; dates must exist on the calendar; at most 500 rows a page. Text is trimmed before it is stored. An update replaces the whole record
- Results: expected refusals are outcomes with a reason (`duplicate`, `in-use`, `not-found`, `too-deep`, `currency-in-use`); anything else reaches the page only as the code `forbidden`, `invalid-argument`, `locked` or `failed`. A call while the vault is locked fails with `locked`
- The page imports `src/shared/ledger.ts`, which holds the constants and types and no zod: zod probes for `new Function`, which the CSP reports as a violation
- Repositories in `src/main/ledger` prepare their statements per call and keep no reference to rows between calls; what still stays in memory until garbage collection, and in SQLite's page cache, is described in SECURITY_DESIGN
- Text is trimmed and stored in Unicode's composed form (NFC). Dates run from 1900 to 2999

## D018 Transaction list and search
- Date: 2026-11-08
- Decision: the list is newest first and loads 200 rows at a time, continuing from the last row shown (`(date, id) < (?, ?)`), so a deep page costs what the first does. Search matches the description and notes with `LIKE`, with `%`, `_` and `\` escaped; letters match without regard to case for ASCII only. Rows outside the view skip layout (`content-visibility: auto`), and a row's category shows as text until clicked, since a select per row put about 66,000 options in the page at 2,200 rows
- Measured with 20,000 seeded transactions, encrypted (2.1 GHz Xeon): first page 0.2 ms, page 91 0.2 ms, a search 0.6 ms, a search with no match 3.3 ms, totals of everything 4.2 ms. In the app under Xvfb with software rendering: a search shows 61 ms after the typing pause; scrolling through 2,200 loaded rows, frames take 24 ms at the median and 48 ms at the 95th percentile, against 17 ms for an idle frame there
- Alternatives: FTS5 (compiled in, and its index would be encrypted like every page) and a virtualized list (`@tanstack/react-virtual`); neither is needed at these numbers. Revisit if a search passes 50 ms or scrolling stutters on real hardware

## D019 Seed data and demo vault
- Date: 2026-11-08
- Decision: `scripts/seed` generates a ledger from a seeded random generator (mulberry32), so a seed and an end date always give the same data. Every merchant and name is invented. The default is about 1,500 transactions over 18 months in four accounts, one of them in yuan: salary, rent and bills on schedules, day-to-day spending by weight, one trip, refunds, and transfers that appear in both accounts (card repayments, savings), which M3 needs for transfer detection
- `npm run seed` bundles the script with Vite and writes a vault to `.demo/user-data`, git-ignored, with a fixed fake password it prints; it refuses to touch an existing vault, and refuses the app's own user data directories (the packaged app's and a development build's). `npm run demo` starts the app on it. Tests call the same generator, with a fast key derivation
- The package check fails when `app.asar` holds anything beyond the main, preload and renderer builds, `package.json` and `node_modules`, where electron-builder puts the runtime dependencies

## D020 Money and currencies
- Date: 2026-11-08
- Decision: amounts stay integer cents (D003) end to end: text becomes cents and cents become text by string arithmetic, and formatting hands `Intl.NumberFormat` a decimal string, never a float. Currencies are limited to those with two decimal places (AUD, CAD, CNY, EUR, GBP, HKD, NZD, SGD, USD). Each account has one currency; totals and balances are given per currency and never added across currencies. Formatting uses `en-AU`. A sum is exact up to 2⁵³ cents, about 90 trillion units
- Later: conversion between currencies (Nice to have)

## D021 Accounts and categories
- Date: 2026-11-08
- Decision: an account's opening balance is a field of the account, not a transaction, so reports will not count it as income; the balance is the opening balance plus every transaction. Names are unique without regard to ASCII case; stored in composed form, names that look the same collide. An account can be deleted only without transactions, and its currency changes only while it has none. Categories nest two levels: a category with subcategories stays at the top. Deleting a category deletes its subcategories too; their transactions become uncategorized and their budgets go with them, and the confirmation says how many transactions it affects
- Later: archiving accounts (Nice to have); rules that point to a deleted category (M3)

## D022 Electron downloads in CI
- Date: 2026-11-08
- Decision: CI caches the Electron zip with `actions/cache` in @electron/get's default cache directory, where both Electron's install script and electron-builder keep it, keyed by OS, architecture and the installed versions of `electron` and `app-builder-lib`. A cached zip is checked against Electron's checksums before use, as a download is, and downloaded again on a mismatch. The install step retries three times, after 15, 45 and 90 seconds, since GitHub release downloads fail with 5xx at times. electron-builder retries its own downloads, including the checksum file it fetches on every build
- Alternatives: a mirror such as `ELECTRON_MIRROR` (another party to trust); `electronDist` pointing electron-builder at `node_modules/electron/dist` (changes how releases are built)

## D023 Reading CSV files
- Date: 2026-11-08
- Decision: the main process reads a CSV file only up to set limits, refusing larger files whole: 10 MB, 50,000 rows, 64 columns, 64 KB in one record. A byte order mark gives the encoding; otherwise UTF-16 when every other byte is zero, as ASCII text in it has, then UTF-8 if the bytes decode strictly, else Windows-1252, and the user can choose another. Fields are split by `csv-parse` 7.0.3 (MIT, no dependencies), with the delimiter, comma, semicolon or tab, the one that splits the first lines into the most columns. Dates and amounts are read strictly, so a cell such as `=1+1` in an amount column makes that row an error; descriptions keep their text, with control characters turned into spaces and bidirectional controls, zero-width spaces and word joiners removed (zero-width joiners stay, for scripts and emoji), and are only ever shown as text. A row that cannot be read is listed with its line and cell, and the other rows can still be imported. Reading and mapping a file at the row limit takes about 0.4 s, a preview of it with duplicate checks about 2 s and importing it about the same; this runs on the main thread, after the user asks for it
- Alternatives: a hand-written parser (quoted line breaks and stray quotes are where they go wrong); PapaParse (built for the browser; its formula escaping is for writing)

## D024 Bank templates
- Date: 2026-11-08
- Decision: built-in layouts for CommBank, NAB, ANZ and Westpac. The banks confirm a CSV export but publish no columns, so each layout follows open-source parsers written against real exports, where at least two agree, and was checked against the synthetic sample files those projects publish: CommBank no header, date, signed amount, description, balance; NAB the 2022 and 2026 headers, `29 May 26` dates, rows shortened when a field is missing; ANZ no header, date, signed amount, description, with or without five more columns; Westpac its header, separate debit and credit columns, and a bank account column, since one file can hold several accounts. No layout has been checked against a real export. The reader therefore accepts the forms these sources differ in: quoting by field or not at all, CRLF or LF, a byte order mark, a missing final line break, blank lines, spaces around fields, two- or four-digit years, thousands separators, credits with or without `+`, amounts with no or one decimal, a header added to a CommBank or ANZ file, and up to a tenth of rows (at least one) that do not fit. The delimiter is the one that splits more than half of the first lines into the same number of columns, the most columns among those. In a semicolon- or tab-separated file, a row longer than usual has its extra cells joined into the description, which is where an unquoted delimiter falls; comma-separated rows are not joined, since a longer one there is more often an amount with an unquoted thousands separator. A file no layout fits gets a guess of its date, amount and description columns for the user to correct in the column wizard. The user chooses the account; nothing is read from the bank's account numbers but the grouping. A bank's own category column (NAB `Category`, Westpac `Categories`) is never imported, so categories stay the user's own; rules categorize instead (D026). Sample files in `tests/fixtures/csv` are made up, following the published structures; no public sample is copied
- Not confirmed by any public source: encodings, credit card variants, ANZ's five extra columns, Westpac files with several accounts, and NAB's `Processed On` format
- `npm run csv:shape` describes a file's structure without any of its values, for reporting a format the app does not read. It prints a header only when it is NAB's or Westpac's own, and describes any other first row by the kind of each cell

## D025 Duplicates and undoing an import
- Date: 2026-11-08
- Decision: an imported row's fingerprint is its date, amount and description (case and spacing aside) plus its occurrence among identical rows of the file, unique within its account (YNAB's `import_id`). Identical genuine rows are occurrences 1 and 2, so both import, and an overlapping later file repeats neither. A row without that match is a possible duplicate when the account has a transaction of the same amount within 4 days that no exact match or earlier row has claimed: each row, in file order, takes the nearest-dated, then most alike, of its 10 nearest unclaimed candidates. Each transaction so answers for one row at most (as Actual's matcher), and of two alike rows against one transaction, one stays new. Possible duplicates start unselected and show the transaction they resemble. Importing never changes or removes a transaction; a deleted transaction does not block importing it again. The page picks rows by their place in the preview, so the main process refuses an import whose encoding, columns or accounts differ from the last preview it made, and the page enables Import only once the preview for its current settings has arrived. An import is one SQLite transaction recorded as a batch. A transaction moved to another account loses its fingerprint, which belongs to the account. Undoing it removes the batch's transactions, edited or not, after a confirmation that counts both; `edited` is set when a change actually alters a transaction. Columns the user changes for a file with a header are remembered by that header; choosing the detected ones forgets them
- File access: only the system open dialog in the main process picks a file; the page never names a path. The file waits in the main process until imported, replaced, or the vault locks or unlocks, when its bytes are zeroed; its parsed text stays until garbage collection, like other decrypted rows (SECURITY_DESIGN)

## D026 Categorization rules
- Date: 2026-11-08
- Decision: a rule matches a description that contains, starts with, or is its text, ignoring case and spacing; there are no regular expressions, since rules run in the main process and a pattern could take unbounded time. Rules run in an order the user can change, and the first that matches decides. A new rule goes in before the first less specific one ("is", then "starts with", then "contains", a longer text before a shorter), and its dialog says how many transactions it matches and how many an earlier rule takes first. Rules categorize imported rows, shown in the preview, and, when the user asks while creating one, the uncategorized transactions they match first; they never change a category already set, and leave paired transfers alone. After the user sets a category by hand, a bar offers a rule when no rule already gives that category, another transaction has the same payee (the description without card numbers, value dates or numbers of three or more digits), and the user has not declined that payee; if a rule sends the payee elsewhere, it offers to update that rule. A payee longer than a rule's 100 characters is cut at a word. Actual creates such rules silently after three consistent changes; here the user confirms each. Deleting a category deletes the rules that give it, and the confirmation counts them, as transactions become uncategorized (D021)

## D027 Transfers between accounts
- Date: 2026-11-08
- Decision: when both accounts' files are imported, a transfer appears twice, money out of one and the same money into the other. Two transactions can be one transfer when they are in different accounts of one currency, their amounts are exactly opposite, they are dated at most 4 days apart (a transfer on a Friday can arrive on Tuesday), and neither is paired already. Candidates that share a transaction form a group. After each import, a group with a side in that import is paired when it is a single pair, or when its same-day pairs give every transaction in it exactly one partner, as equal transfers made and credited on the same days do; any other group waits for the user, and older rows are never paired on their own. Rows an import pairs lose any category a rule gave them. The page says how many it paired. Every other candidate, and any that later edits or decisions leave, is listed under Transfers for the user to pair or turn down. The user can also pair two transactions by hand from either one, at any distance in time, and split a pair, after which that pair is not offered again. Changing the amount or account of either side, or deleting it, unpairs it. A paired transaction shows as a transfer with the other account in place of a category and is left out of the uncategorized filter. Reports read the `report_transactions` view, which leaves out both sides of every pair; that is the exclusion, not a category, so a transfer to an account the ledger does not track stays spending. Undoing an import says how many of its transactions are paired as transfers, and unpairs them with it. The seed pairs its savings transfers and card repayments the same way
- Alternatives: a "Transfer" category (Lunch Money, Monarch), which a mistyped category silently breaks; pairing at the first candidate (wrong when two alike amounts move in one week)

## D028 Budgets
- Date: 2026-11-08
- Decision: a budget belongs to a category and a month, and holds for later months until the category gets another row; a row without an amount ends it. Spending is the category's transactions in the month, its subcategories' included, from `report_transactions`, so paired transfers never count; refunds reduce it and it is never below zero. Parent and subcategory budgets are measured separately. Budgets and their spending are in one home currency, a setting (D032, AUD by default); spending in other currencies is listed beside them, not converted. A budget is close from 90% spent and over past 100%. The app tells the user in its own pages (progress bars, a count in the sidebar, a bar when a category first goes over), never through system notifications

## D029 Overview and reports
- Date: 2026-11-08
- Decision: reports read `report_transactions`, one currency at a time, never converted. Income and spending net each top-level category (its subcategories included) and the uncategorized bucket over the month: a negative net counts as spending, a positive one as income. A refund so lowers spending in its category, and a category with more refunds than purchases shows as income. The Reports page shows twelve months to the chosen month, that month's spending by category, and one category's twelve-month trend. Overview opens after unlock and shows this month's income and spending for the home currency and any currency used this month, budgets that are set, and the five latest transactions. Charts are SVG drawn from plain shapes with classes for colors, so the same geometry serves the page and the PDF export, under a CSP without inline styles
- Alternatives: a chart library (Recharts, Chart.js) adds dependencies and draws with canvas or inline styles; summing positive and negative transactions separately counts a refund as income

## D030 Excel export
- Date: 2026-11-08
- Decision: the monthly statement (summary, budgets for the home currency, the month's transactions with transfers marked) is written as xlsx by a small writer of our own: six SpreadsheetML parts zipped with fflate 0.8.3 (MIT, no dependencies). Text is always an inline string and the writer has no formula element, so no cell is a formula. Text cells use the Text number format (49), so a cell edited later is not reread as a formula, and text that starts like one (OWASP: `=`, `+`, `-`, `@`, tab, carriage return, line feed, and the full-width `＝＋－＠`) also gets `quotePrefix`, the stored form of a leading apostrophe. `_xHHHH_` in text is escaped, since Excel reads it as a character code; characters XML cannot hold are dropped. The zip carries a fixed timestamp and no document properties. For a future CSV export, `csvField` quotes every field, doubles inner quotes, and prefixes formula starts with an apostrophe (OWASP)
- Checked in LibreOffice: every formula start above, `=HYPERLINK(...)` and `_x0041_` show as typed, dates and amounts keep their formats. Excel and Numbers have not been tried (TASKS, M5)
- Alternatives: exceljs 4.4.0 (193 packages installed, 53.8 MB, last release 2023, two moderate advisories through uuid); the npm `xlsx` package (SheetJS 0.18.5, no longer updated there, one high advisory; newer versions only from SheetJS's own CDN, outside npm audit); write-excel-file (two packages, fflate included); zipping with Node's zlib (no dependency, but a zip container of our own to maintain)

## D031 PDF export and saving exports
- Date: 2026-11-08
- Decision: the main process writes the statement as one static HTML page (totals, the twelve-month and category charts as SVG markup from the shared chart geometry, budgets, the month's transactions) and prints it with `printToPDF` in a hidden `BrowserWindow` made for that export alone: sandboxed, no preload, JavaScript off. The page and its stylesheet are served from memory at a random `app://` path under `/print/`, with a CSP of `script-src 'none'` and `Cache-Control: no-store`, and released when printing ends. The PDF comes back as a buffer; its title is fixed text, its fonts the system's. Every export, Excel or PDF, starts with the system save dialog in the main process; the page never names a path. The file is written with mode 0600 and the buffer zeroed. A lock or unlock at any point (dialog open, page printing) aborts the export and nothing is written; one export runs at a time
- Alternatives: a PDF library such as pdfkit or jsPDF (dependencies, and layout by hand); a `data:` URL for the page (Chromium then ignores CSS page breaks); printing the app's own window (its scripts and state are those of the live page)

## D032 Settings
- Date: 2026-11-08
- Decision: preferences live in a `settings` table inside the vault, so they are encrypted with the ledger and travel with its backups; a missing or unknown value reads as its default. The home currency (AUD by default) decides which currency budgets measure; changing it keeps budget amounts as they are, now counted in the new currency, after a confirmation that says how many budgets that affects. The idle lock time is 1, 5, 15 or 30 minutes (5 by default) and is read on every idle check while the vault is open; there is no option to turn idle locking off. Screen lock and sleep still lock at once
- Alternatives: settings in a plaintext file beside the vault (they would reveal the user's currency); converting budget amounts (needs exchange rates, which means a network request)

## D033 Backups
- Date: 2026-11-08
- Decision: a backup is one `.llbackup` file: `LLBACKUP`, a header length, a JSON header, and the database file exactly as the vault holds it, its pages already encrypted with the data key. The header seals the data key the way `vault.json` does (Argon2id settings and salt from the vault, AES-256-GCM, a fresh nonce), with associated data `local-ledger backup v1` plus the database's schema version, length and SHA-256, so a header and a database from different backups, or a cut, extended or altered file, do not open. Making one asks for the master password, which unseals the vault's key and seals the backup's; nothing is decrypted or re-encrypted, and no other file is written. The file goes where the user picks in the system save dialog, owner-only, and a lock or unlock while the dialog is open cancels it
- Alternatives: a ZIP of the vault folder (two files to keep in step, and `vault.json` carries the generation); SQLite's backup API into a new file (pages pass through decrypted in memory); a separate backup password (one more secret to forget)

## D034 Restoring a backup
- Date: 2026-11-08
- Decision: a restore never deletes data. The chosen backup is checked first with its own password: the key must open, the database must open, pass `integrity_check` and have a schema no newer than this app's, and its copy is staged in a directory of its own; the dialog then says how many accounts and transactions it holds and its latest date. Only after the user confirms is the staged copy made a whole vault, the current vault renamed to `vault-before-restore-<date and time>` beside it, and the restored one renamed into place. A crash before the old vault is renamed leaves it in use; after, startup finishes the restore from the staged vault, as it does for an interrupted create (D013). From Settings, with the vault open, the user also enters the current master password, and the restored vault keeps it: the backup's data key is sealed again under that password. From the setup page, where there is no vault, the restored vault opens with the backup's password, which the dialog says. The locked page offers no restore, so no one can replace a vault without its password. A lock or unlock drops a backup that was chosen or checked
- Copies: the backup file itself still opens with the password it was made under, and the renamed vault with the password it had; the app never removes either
- Alternatives: restoring with the backup's password from Settings too (the password in use would change without a password change); merging a backup into the vault (duplicate and conflicting rows)
