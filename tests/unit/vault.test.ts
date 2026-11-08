import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
  closeSync,
  truncateSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/main/vault/database'
import { deriveHere } from '../../src/main/vault/kdf'
import type { KdfParams } from '../../src/main/vault/kdf'
import { openKey } from '../../src/main/vault/keys'
import { migrations } from '../../src/main/vault/migrations'
import { parseVaultFile } from '../../src/main/vault/vault-file'
import { BusyError, LockedError, Vault } from '../../src/main/vault/vault'
import type { VaultState } from '../../src/shared/ipc'

const FAST: KdfParams = {
  memoryKiB: 19_456,
  iterations: 2,
  parallelism: 1,
}
const PASSWORD = 'fake ledger passphrase for tests'

let root: string
let vault: Vault
/** Runs once, as the next key derivation starts. */
let duringDerivation: (() => void) | null = null
let derivations = 0
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ledger-vault-'))
  duringDerivation = null
  derivations = 0
  vault = new Vault(root, {
    derive: (...args) => {
      derivations++
      const hook = duringDerivation
      duringDerivation = null
      hook?.()
      return deriveHere(...args)
    },
    kdf: FAST,
  })
})
afterEach(async () => {
  vault.lock()
  rmSync(root, { recursive: true, force: true })
})

const files = () => readdirSync(vault.dir).sort()

describe('create', () => {
  it('creates an unlocked vault with one database generation', async () => {
    expect(vault.state).toBe('new')
    expect(await vault.create(PASSWORD)).toEqual({ ok: true })
    expect(vault.state).toBe('unlocked')
    expect(files()).toEqual(['ledger-1.db', 'vault.json'])
    expect(vault.database().pragma('user_version', { simple: true })).toBe(
      migrations.length,
    )
  })

  it.skipIf(process.platform === 'win32')(
    'keeps the vault directory and vault.json to their owner',
    async () => {
      await vault.create(PASSWORD)
      expect(statSync(vault.dir).mode & 0o777).toBe(0o700)
      expect(statSync(join(vault.dir, 'vault.json')).mode & 0o777).toBe(0o600)
    },
  )

  it('does not replace an existing vault', async () => {
    await vault.create(PASSWORD)
    vault.lock()
    expect(await vault.create('another fake passphrase')).toEqual({
      ok: false,
      reason: 'exists',
    })
    expect(await vault.unlock(PASSWORD)).toEqual({ ok: true })
  })

  it('leaves no vault when interrupted before the final rename', async () => {
    const crashing = new Vault(root, {
      derive: deriveHere,
      kdf: FAST,
      checkpoint: (step) => {
        if (step === 'vault staged') throw new Error('crash')
      },
    })
    await expect(crashing.create(PASSWORD)).rejects.toThrow('crash')
    expect(crashing.state).toBe('new')
    // The next attempt clears the staging directory and succeeds.
    expect(await vault.create(PASSWORD)).toEqual({ ok: true })
    expect(readdirSync(root)).toEqual(['vault'])
  })

  it.each([
    ['waits its turn', () => vault.lock(), 0],
    ['derives its key', () => (duringDerivation = () => vault.lock()), 1],
  ])(
    'is cancelled by a lock while it %s, and leaves nothing',
    async (_while, setUpLock, derived) => {
      const creating = vault.create(PASSWORD)
      setUpLock()
      expect(await creating).toEqual({ ok: false, reason: 'locked' })
      expect(derivations).toBe(derived)
      expect(vault.state).toBe('new')
      expect(readdirSync(root)).toEqual([])
    },
  )

  it('shows a vault that is in place but did not open', async () => {
    const failing = new Vault(root, {
      derive: deriveHere,
      kdf: FAST,
      checkpoint: (step) => {
        if (step !== 'vault staged') return
        const [staging] = readdirSync(root)
        truncateSync(join(root, staging ?? '', 'ledger-1.db'), 0)
      },
    })
    const seen: VaultState[] = []
    failing.onChange((state) => seen.push(state))
    await expect(failing.create(PASSWORD)).rejects.toThrow('did not open')
    expect(seen).toEqual(['locked'])
  })
})

describe('unlock and lock', () => {
  beforeEach(async () => {
    await vault.create(PASSWORD)
    vault.lock()
  })

  it('locks by closing the database', async () => {
    await vault.unlock(PASSWORD)
    const db = vault.database()
    expect(vault.lock()).toBe(true)
    expect(db.open).toBe(false)
    expect(vault.state).toBe('locked')
    expect(() => vault.database()).toThrow(LockedError)
  })

  it('unlocks with the password only', async () => {
    expect(await vault.unlock(`${PASSWORD}!`)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(vault.state).toBe('locked')
    expect(await vault.unlock(PASSWORD)).toEqual({ ok: true })
    expect(vault.state).toBe('unlocked')
  })

  it('tells listeners about every change', async () => {
    const seen: VaultState[] = []
    vault.onChange((state) => seen.push(state))
    await vault.unlock(PASSWORD)
    vault.lock()
    expect(seen).toEqual(['unlocked', 'locked'])
  })

  it.each([
    ['waits its turn', () => vault.lock(), 0],
    ['derives its key', () => (duringDerivation = () => vault.lock()), 1],
  ])(
    'cancels an unlock that %s, and replaces the page',
    async (_while, setUpLock, derived) => {
      const seen: VaultState[] = []
      vault.onChange((state) => seen.push(state))
      derivations = 0
      const unlocking = vault.unlock(PASSWORD)
      setUpLock()
      expect(await unlocking).toEqual({ ok: false, reason: 'locked' })
      expect(derivations).toBe(derived)
      expect(vault.state).toBe('locked')
      expect(seen).toEqual(['locked'])
      expect(await vault.unlock(PASSWORD)).toEqual({ ok: true })
    },
  )

  it('does nothing on a lock with nothing open or waiting', () => {
    const seen: VaultState[] = []
    vault.onChange((state) => seen.push(state))
    expect(vault.lock()).toBe(false)
    expect(seen).toEqual([])
  })

  it('replaces a page that asks to unlock an open vault', async () => {
    await vault.unlock(PASSWORD)
    const seen: VaultState[] = []
    vault.onChange((state) => seen.push(state))
    expect(await vault.unlock('any fake passphrase at all')).toEqual({
      ok: true,
    })
    expect(seen).toEqual(['unlocked'])
  })

  it('stays unlocked when a listener fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vault.onChange(() => {
      throw new Error('the window is gone')
    })
    expect(await vault.unlock(PASSWORD)).toEqual({ ok: true })
    expect(vault.state).toBe('unlocked')
    expect(log).toHaveBeenCalledWith('vault listener failed: Error')
    log.mockRestore()
  })

  it('refuses more than a few waiting operations', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => vault.unlock('not the fake passphrase')),
    )
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'rejected',
    ])
    expect(results[4]).toMatchObject({ reason: expect.any(BusyError) })
  })

  it('reports a database from a newer app', async () => {
    await vault.unlock(PASSWORD)
    vault.database().pragma(`user_version = ${migrations.length + 1}`)
    vault.lock()
    expect(await vault.unlock(PASSWORD)).toEqual({ ok: false, reason: 'newer' })
  })
})

describe('a damaged vault', () => {
  beforeEach(async () => {
    await vault.create(PASSWORD)
    vault.lock()
  })

  it('is reported when vault.json is missing or invalid, and nothing is deleted', async () => {
    rmSync(join(vault.dir, 'vault.json'))
    expect(vault.state).toBe('damaged')
    expect(await vault.unlock(PASSWORD)).toEqual({
      ok: false,
      reason: 'damaged',
    })
    expect(files()).toEqual(['ledger-1.db'])

    writeFileSync(join(vault.dir, 'vault.json'), '{"version":1}')
    expect(vault.state).toBe('damaged')
    expect(files()).toEqual(['ledger-1.db', 'vault.json'])
  })

  it('is reported when the database is missing, and nothing is deleted', async () => {
    rmSync(join(vault.dir, 'ledger-1.db'))
    writeFileSync(join(vault.dir, 'ledger-2.db'), 'unrelated')
    expect(vault.state).toBe('damaged')
    expect(await vault.unlock(PASSWORD)).toEqual({
      ok: false,
      reason: 'damaged',
    })
    expect(files()).toEqual(['ledger-2.db', 'vault.json'])
  })

  it('is reported when the database bytes are corrupted', async () => {
    const fd = openSync(join(vault.dir, 'ledger-1.db'), 'r+')
    writeSync(fd, Buffer.alloc(64, 0xff), 0, 64, 100)
    closeSync(fd)
    expect(await vault.unlock(PASSWORD)).toEqual({
      ok: false,
      reason: 'damaged',
    })
    expect(vault.state).toBe('locked')
  })

  it('is reported when a page past the first fails quick_check, and nothing is deleted', async () => {
    await vault.unlock(PASSWORD)
    const db = vault.database()
    db.prepare(
      "INSERT INTO accounts (name, type, currency) VALUES ('Fake Bank', 'bank', 'AUD')",
    ).run()
    const insert = db.prepare(
      "INSERT INTO transactions (account_id, date, amount_cents, description) VALUES (1, '2026-01-31', ?, 'Fake purchase')",
    )
    db.transaction(() => {
      for (let cents = 0; cents < 2000; cents++) insert.run(cents)
    })()
    vault.lock()
    writeFileSync(join(vault.dir, 'ledger-2.db'), 'leftover')
    const fd = openSync(join(vault.dir, 'ledger-1.db'), 'r+')
    writeSync(fd, Buffer.alloc(32, 0x5a), 0, 32, 5 * 4096 + 200)
    closeSync(fd)
    expect(await vault.unlock(PASSWORD)).toEqual({
      ok: false,
      reason: 'damaged',
    })
    expect(files()).toEqual(['ledger-1.db', 'ledger-2.db', 'vault.json'])
  })

  it('is reported when the database is an empty file, and nothing is deleted or written', async () => {
    truncateSync(join(vault.dir, 'ledger-1.db'), 0)
    writeFileSync(join(vault.dir, 'ledger-2.db'), 'leftover')
    expect(await vault.unlock(PASSWORD)).toEqual({
      ok: false,
      reason: 'damaged',
    })
    expect(files()).toEqual(['ledger-1.db', 'ledger-2.db', 'vault.json'])
    expect(statSync(join(vault.dir, 'ledger-1.db')).size).toBe(0)
  })
})

describe('leftovers', () => {
  beforeEach(async () => {
    await vault.create(PASSWORD)
    vault.lock()
    for (const name of [
      'ledger-2.db',
      'ledger-2.db.tmp',
      'ledger-2.db-journal',
      'vault.json.tmp',
      'notes.txt',
    ]) {
      writeFileSync(join(vault.dir, name), 'leftover')
    }
  })

  it('are kept after a failed unlock', async () => {
    await vault.unlock('not the fake passphrase')
    expect(files()).toHaveLength(7)
  })

  it('are removed once the current database opens and passes quick_check, except unknown files', async () => {
    await vault.unlock(PASSWORD)
    expect(files()).toEqual(['ledger-1.db', 'notes.txt', 'vault.json'])
  })

  it('that cannot be removed do not fail the unlock', async () => {
    // A directory stands in for a file another program holds open.
    mkdirSync(join(vault.dir, 'ledger-3.db'))
    writeFileSync(join(vault.dir, 'ledger-3.db', 'held'), '')
    expect(await vault.unlock(PASSWORD)).toEqual({ ok: true })
    expect(files()).toEqual([
      'ledger-1.db',
      'ledger-3.db',
      'notes.txt',
      'vault.json',
    ])
  })
})

describe('the data key', () => {
  it('is sealed in vault.json and opens the database as a raw key', async () => {
    await vault.create(PASSWORD)
    vault.lock()
    const file = parseVaultFile(
      readFileSync(join(vault.dir, 'vault.json'), 'utf8'),
    )
    if (!file) throw new Error('unreadable vault.json')
    const dataKey = await openKey(file, PASSWORD, deriveHere)
    if (!dataKey) throw new Error('wrong password')
    const db = openDatabase(join(vault.dir, 'ledger-1.db'), dataKey)
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
    db.close()
  })
})

describe('staging', () => {
  it('removes staging directories left by an interrupted create', async () => {
    mkdirSync(join(root, 'vault.creating-old'))
    writeFileSync(join(root, 'vault.creating-old', 'vault.json'), '{}')
    await vault.create(PASSWORD)
    expect(existsSync(join(root, 'vault.creating-old'))).toBe(false)
  })
})
