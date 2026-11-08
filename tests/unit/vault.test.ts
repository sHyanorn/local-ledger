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
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/vault/database'
import { deriveHere } from '../../src/main/vault/kdf'
import type { KdfParams } from '../../src/main/vault/kdf'
import { openKey } from '../../src/main/vault/keys'
import { migrations } from '../../src/main/vault/migrations'
import { parseVaultFile } from '../../src/main/vault/vault-file'
import { LockedError, Vault } from '../../src/main/vault/vault'
import type { VaultState } from '../../src/shared/ipc'

const FAST: KdfParams = {
  memoryKiB: 19_456,
  iterations: 2,
  parallelism: 1,
}
const PASSWORD = 'fake ledger passphrase for tests'

let root: string
let vault: Vault
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ledger-vault-'))
  vault = new Vault(root, { derive: deriveHere, kdf: FAST })
})
afterEach(async () => {
  await vault.lock()
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
    await vault.lock()
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
})

describe('unlock and lock', () => {
  beforeEach(async () => {
    await vault.create(PASSWORD)
    await vault.lock()
  })

  it('locks by closing the database', async () => {
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
    await vault.lock()
    expect(seen).toEqual(['unlocked', 'locked'])
  })

  it('runs operations in call order', async () => {
    const order: string[] = []
    await Promise.all([
      vault.unlock(PASSWORD).then(() => order.push('unlock')),
      vault.lock().then(() => order.push('lock')),
    ])
    expect(order).toEqual(['unlock', 'lock'])
    expect(vault.state).toBe('locked')
  })

  it('reports a database from a newer app', async () => {
    await vault.unlock(PASSWORD)
    vault.database().pragma(`user_version = ${migrations.length + 1}`)
    await vault.lock()
    expect(await vault.unlock(PASSWORD)).toEqual({ ok: false, reason: 'newer' })
  })
})

describe('a damaged vault', () => {
  beforeEach(async () => {
    await vault.create(PASSWORD)
    await vault.lock()
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
})

describe('leftovers', () => {
  beforeEach(async () => {
    await vault.create(PASSWORD)
    await vault.lock()
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
})

describe('the data key', () => {
  it('is sealed in vault.json and opens the database as a raw key', async () => {
    await vault.create(PASSWORD)
    await vault.lock()
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
