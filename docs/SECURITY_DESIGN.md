# Security Design

Local Ledger keeps personal finance data on one computer, encrypted at rest. This document describes the encryption, what each part protects against, and what it does not. Electron hardening is summarized here and recorded in DECISIONS (D009, D010, D012); M5 completes this document.

## Threat model

Protected against:

- Someone who obtains the vault files: a copied or stolen disk, a backup, a synced folder. Without the master password the files reveal nothing but their size and the key derivation settings.
- Someone at the computer after the app locked itself (idle, screen lock, sleep).
- Web content: the app loads none. The renderer is sandboxed, has no Node.js, and reaches the main process only through a fixed, validated IPC API.

Not protected against:

- Malware running as the same user while the vault is unlocked. It can read process memory or the screen. The packaged app refuses the debugging entry points (fuses, remote debugging switches), which closes the easiest route but not every one.
- A weak master password. Argon2id slows guessing; it does not make a guessable password safe.
- A forgotten master password. There is no recovery.

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

A wrong password fails the GCM check without touching the database. A sealing key that opens `vault.json` but a database that does not decrypt, or fails `quick_check`, means a damaged vault.

## Lifecycle

- **Create**: the vault is built in a staging directory and renamed into place, so a crash leaves no vault or a whole one.
- **Unlock**: derive the sealing key in a worker thread, unseal the data key, open the current generation and run `quick_check`. Only then are leftovers of an interrupted change removed.
- **Lock**: close the database; SQLite3 Multiple Ciphers wipes its key schedule when it frees the cipher context. The page is replaced, and its renderer process exits.
- **Auto-lock**: after 5 minutes of system idle time, when the screen locks, when the computer sleeps, when the window closes.
- **Change password**: a new data key under the new password. The database is copied, the copy re-encrypted and checked, flushed and renamed to the next generation; replacing `vault.json` (write, flush, rename, flush the directory) is the single commit point. A crash before it leaves the old password working, after it the new one. Tests copy the disk at every step and check exactly that.
- **Damaged vault**: a missing or invalid `vault.json`, or a missing current database, is reported and nothing is deleted.

On Windows, a directory cannot be flushed; renames rely on NTFS `MoveFileEx` semantics.

## Memory

What the app does:

- The data key, the sealing key, the encoded password and the raw key literal live in buffers the app owns and fills with zeros after use. While unlocked, the only copy of the data key is inside SQLite.
- Argon2id runs in a worker thread that ends after each derivation, releasing its 64 MiB.
- On unlock, lock and password change, the renderer process that showed the previous page ends.

What it cannot do, and does not claim:

- JavaScript strings are immutable and cannot be wiped. The master password exists as strings in the renderer that took it (the input's value, React state) until that process ends, and in the main process after crossing IPC until garbage collection reclaims it. V8 may have copied it while compacting the heap.
- Memory that is released, by a worker or a renderer process, is returned to the operating system, not overwritten by the app.
- Decrypted data read from the database becomes JavaScript strings in the main process and stays there until garbage collection.
- The operating system may write any of this memory to swap or a hibernation file. The app does not lock pages in memory.

## Electron hardening

- Renderer: `contextIsolation`, `sandbox` (checked at the OS level in tests), no Node.js integration, no webview, spellcheck off. The page is served from `app://local-ledger` with a strict CSP on every response.
- New windows, navigation, redirects and permission requests are refused; the session cancels every request outside the app. Tests read a Chromium net log and fail on any network request.
- IPC: one handler per channel; each checks that the sender is the app's own page and validates its payload with zod. Errors carry codes, never the payload.
- The app refuses to start with any switch that weakens the Chromium sandbox and, when packaged, with a remote debugging port.
- Fuses: no `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` or `--inspect`; the app loads only from an integrity-checked `app.asar`; `file://` gets no extra privileges. The native SQLite binary sits in `app.asar.unpacked`, outside the integrity check.
- Releases are unsigned (D006); the release workflow (M5) publishes checksums and build provenance attestations to verify downloads with.
