# Security Design

Local Ledger keeps personal finance data on one computer, encrypted at rest. This document describes the encryption, what each part protects against, and what it does not. Electron hardening is summarized here and recorded in DECISIONS (D009, D010, D012); M5 completes this document.

## Threat model

Protected against:

- Someone who obtains the vault files: a copied or stolen disk, a backup, a synced folder. Without the master password the files reveal nothing but their size, the key derivation settings and the generation number, which counts password changes.
- Someone at the computer after the app locked itself (idle, screen lock, sleep).
- Web content: the app loads none. The renderer is sandboxed, has no Node.js, and reaches the main process only through a fixed, validated IPC API.

Not protected against:

- Malware running as the same user. While the vault is unlocked it can read process memory or the screen; while it is locked it can record the password at the next unlock. The packaged app refuses the debugging entry points (fuses, remote debugging switches), which closes the easiest route but not every one.
- A weak master password. Argon2id slows guessing; it does not make a guessable password safe.
- A forgotten master password. There is no recovery.
- Files the user exports or imports. They are plaintext wherever the user keeps them.
- Old copies: a backup still opens with the password it was made under, and a vault replaced by a restore with the password it had.

## Key hierarchy

```
master password
  → NFKC normalization, UTF-8
  → Argon2id (m=64 MiB, t=3, p=4, 16-byte random salt)  → 32-byte sealing key
  → AES-256-GCM, authenticated header                    → seals the data key
data key (32 random bytes)
  → SQLCipher v4 raw key                                 → encrypts every database page
```

- `vault/vault.json` (plaintext): format version, generation, Argon2id settings and salt, the GCM nonce and the sealed data key. The header (version, generation, settings, salt) is GCM associated data, so editing any of it makes unsealing fail. Settings outside fixed bounds are rejected before any work is done.
- `vault/ledger-<generation>.db`: the database, every page encrypted with the data key (SQLite3 Multiple Ciphers, `cipher=sqlcipher`, `legacy=4`). The rollback journal is encrypted the same way. Temporary storage stays in memory.
- The vault directory is created owner-only (0700 on macOS and Linux); `vault.json` is written 0600.

A wrong password fails the GCM check without touching the database. A sealing key that opens `vault.json` but a database that does not decrypt, is empty, or fails `quick_check` means a damaged vault. These checks run before migrations, so nothing is written to a damaged file.

## Lifecycle

- **Create**: the vault is built in a staging directory and renamed into place, so a crash leaves no vault or a whole one. If the rename was lost (a power cut after a failed directory flush), the app finds the whole vault in its staging directory at startup and puts it back.
- **Unlock**: derive the sealing key in a worker thread, unseal the data key, open the current generation and run `quick_check`. Only then, and once a directory flush shows that `vault.json` names that generation on disk, are leftovers of an interrupted change removed.
- **Lock**: close the database; SQLite3 Multiple Ciphers wipes its key schedule when it frees the cipher context. The page is replaced, and its renderer process exits; this happens on every lock, also when the vault was already locked, so a password typed but not submitted does not survive it. A lock takes effect at once, without waiting for other vault operations, and cancels an unlock, create or password change that is still deriving its key.
- **Auto-lock**: after the system has been idle for the time set in Settings (1, 5, 15 or 30 minutes; 5 by default, with no option to turn it off), when the screen locks, when the computer sleeps, when the window closes. Closing the window also ends its page process.
- **Change password**: a new data key under the new password. The database is copied, the copy re-encrypted, checked with `integrity_check`, flushed and renamed to the next generation. Renaming the new `vault.json` over the old one is the single commit point: a crash before it leaves the old password working, after it the new one. A failure without a crash reopens whichever generation `vault.json` on disk names: before the commit the page reports the failure and the old password stays, after it the change stands. The old generation is deleted only after a later directory flush succeeds; Windows cannot flush a directory and relies on NTFS. Copies of the old generation, in backups, synced folders or unallocated disk blocks, still open with the old password. Tests copy the disk at each of the five steps of a change and check that exactly one password works, and fail the change at each step without a crash and check the same.
- **Damaged vault**: a missing or invalid `vault.json`, a missing current database, or one that is empty or fails `quick_check`, is reported and nothing is deleted.

On Windows, a directory cannot be flushed; renames rely on NTFS `MoveFileEx` semantics.

## Memory

What the app does:

- The data key, the sealing key, the encoded password and the raw key literal live in buffers the app owns and fills with zeros after use, also when an operation fails or is cancelled. While unlocked, the only copy of the data key is inside SQLite.
- Argon2id runs in a worker thread that ends after each derivation, releasing its 64 MiB.
- On unlock, lock and a password change that commits, the renderer process that showed the previous page ends.
- A password change that fails keeps its page so it can say so, and clears its fields; the typed passwords stay in that process as strings until the next lock ends it.
- The data handlers keep no reference to rows between calls. A test shows a transaction, locks, and checks that its text is gone from the pages and no longer reachable in the main process heap: a heap snapshot collects garbage first and here keeps strings whole. It does not see the contents of Buffers and other binary arrays, nor memory already freed.
- A CSV file being imported waits in the main process until it is imported, another is chosen, or the vault locks or unlocks; then its bytes are zeroed and its parsed rows dropped. Bytes read but refused are zeroed too. A test imports one file, leaves another waiting, locks, and checks that neither file's text is reachable.

What it cannot do, and does not claim:

- JavaScript strings are immutable and cannot be wiped. The master password exists as strings in the renderer that took it (the input's value, React state) until that process ends, and in the main process after crossing IPC until garbage collection reclaims it. V8 may have copied it while compacting the heap.
- Memory that is released, by a worker or a renderer process, is returned to the operating system, not overwritten by the app.
- Decrypted data read from the database becomes JavaScript strings in the main process and stays there until garbage collection.
- While unlocked, SQLite keeps up to 16 MB of decrypted pages in its page cache in the main process. Closing the database frees them without overwriting; this build of SQLite3 Multiple Ciphers leaves its secure memory option off.
- The operating system may write any of this memory to swap or a hibernation file. The app does not lock pages in memory.

## Importing files

- Only the system open dialog, shown by the main process, picks a file by path; the page cannot name a path, and its IPC payloads carry no paths. A file dropped on the window is read by the page, which can read only what the user dropped, and its bytes (at most 10 MB, checked again in the main process) go through the same reading as a chosen file. Only a regular file is read: the path is checked before it is opened, without waiting, and the open handle must be that same file. It is read through that handle, never past the limit, whatever size the file system reports; if the vault locked while the dialog was open, nothing is read.
- A file is refused whole past 10 MB, 50,000 rows, 64 columns or 64 KB in one record. Fields are split by `csv-parse`; dates and amounts are read strictly. Every request from the page is validated with zod, and an import is computed again in the main process from the settings of the last preview, refusing any others, before anything is written.
- Text from a file is stored without control characters, bidirectional controls or zero-width spaces, and shown only as text, so a cell such as `=HYPERLINK(...)` does nothing in the app. Exports neutralize such text for spreadsheets (below).
- The source file stays where it is, unencrypted, and its name is stored inside the vault for the import history. Deleting or protecting the original is up to the user.

## Backups and restores

- A backup (`.llbackup`) is the encrypted database exactly as the vault holds it, plus a header that seals the data key under the master password the way `vault.json` does. The sealing's associated data covers the format, the schema version, the database's length and SHA-256, and the Argon2id settings, so a cut or altered file, or a header and database from different backups, do not open. Making one asks for the current master password; nothing is decrypted, and the file is written owner-only where the user picks.
- SQLCipher authenticates each page with the data key, but not the database as a whole against an older copy of the same pages; the SHA-256 in the sealed header binds a backup's pages together.
- A restore checks the backup with its own password (key, `integrity_check`, schema version) before anything changes, and stages it in a separate directory that a later start removes if the restore does not happen. On confirmation the current vault is renamed to `vault-before-restore-<date and time>` and never deleted by the app; deleting it is up to the user. A crash leaves either the old vault in use or, at the next start, the restored one.
- From Settings, the restored vault keeps the current master password: the user enters it, and the backup's data key is sealed again under it. The backup file still opens with the password it was made with. From the setup page, with no vault, the restored vault opens with the backup's password. The locked page offers no restore.
- A lock or unlock drops a chosen or checked backup: the staged copy is removed and its key zeroed.

## Exporting

- An export is a month's statement in one currency, as an Excel workbook or a PDF. It is not encrypted. The export dialog says so before the user goes on, and the file is written only where the user picks in the system save dialog, shown by the main process; the page cannot name a path. The file is made readable by the user only (mode 0600 where the file system has modes), also when it replaces an existing file. The app keeps no list of exported files and never deletes or changes them.
- Nothing else is written: the workbook is built in memory, and the PDF is printed from a page served from memory at a random `app://` path that exists only while it prints, marked `no-store`, by a hidden window made for that export with no preload and JavaScript off; its process ends after printing. The buffer holding the file is zeroed once written. The statement's text, as for any query, stays as strings in the main process until garbage collection.
- A lock or unlock while the save dialog is open, or while the PDF prints, cancels the export, and nothing is written.
- Spreadsheet formulas: every text cell is an inline string, so the file holds no formula. Text that starts like one, once characters XML cannot hold are dropped (`=`, `+`, `-`, `@`, tab, carriage return, line feed, or the full-width `＝＋－＠`, following OWASP) is also marked with the cell's quote prefix, and all text cells use the Text format, so editing a cell does not turn it into a formula. Checked in LibreOffice; Excel and Numbers have not been tried (D030).
- The PDF's title is fixed text. The PDF records the time it was made.

## Electron hardening

- Renderer: `contextIsolation`, `sandbox` (checked at the OS level in tests), no Node.js integration, no webview, spellcheck off. The page is served from `app://local-ledger` with a strict CSP on every response.
- New windows, navigation, redirects and permission requests are refused; the session cancels every request outside the app. Tests read a Chromium net log and fail on any network request.
- IPC: one handler per channel; each checks that the sender is the app's own page and validates its payload with zod (D017). The data channels need the vault unlocked. A failure reaches the page as a code only; the main process logs the channel and an error code, never a message or the payload.
- The app refuses to start with any switch that weakens the Chromium sandbox and, when packaged, with a remote debugging port.
- Fuses: no `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` or `--inspect`; the app loads only from an integrity-checked `app.asar`; `file://` gets no extra privileges. The native SQLite binary sits in `app.asar.unpacked`, outside the integrity check.
- Releases are unsigned (D006); the release workflow (M5) publishes checksums and build provenance attestations to verify downloads with.
