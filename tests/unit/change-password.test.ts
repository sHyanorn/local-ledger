import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, WrongKeyError } from '../../src/main/vault/database'
import { deriveHere } from '../../src/main/vault/kdf'
import type { KdfParams } from '../../src/main/vault/kdf'
import { openKey } from '../../src/main/vault/keys'
import { parseVaultFile } from '../../src/main/vault/vault-file'
import { Vault } from '../../src/main/vault/vault'

const FAST: KdfParams = { memoryKiB: 19_456, iterations: 2, parallelism: 1 }
const OLD = 'old fake ledger passphrase'
const NEW = 'new fake ledger passphrase'

// Each step of a change, and which password a crash right after it leaves
// working. Replacing vault.json is the commit point.
const STEPS = [
  ['copied', OLD],
  ['re-encrypted', OLD],
  ['renamed', OLD],
  ['temporary file written', OLD],
  ['committed', NEW],
] as const

let root: string
let snapshots: string
const open: Vault[] = []
const vaultAt = (dir: string, checkpoint?: (step: string) => void) => {
  const vault = new Vault(dir, { derive: deriveHere, kdf: FAST, checkpoint })
  open.push(vault)
  return vault
}
const files = (vault: Vault) => readdirSync(vault.dir).sort()
const fakeAccounts = (vault: Vault) =>
  vault
    .database()
    .prepare('SELECT name FROM accounts ORDER BY id')
    .pluck()
    .all()

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ledger-change-'))
  snapshots = mkdtempSync(join(tmpdir(), 'ledger-snapshots-'))
})
afterEach(async () => {
  for (const vault of open.splice(0)) await vault.lock()
  rmSync(root, { recursive: true, force: true })
  rmSync(snapshots, { recursive: true, force: true })
})

/** A vault with fake data, whose checkpoint copies the disk at every step. */
async function vaultWithSnapshots(): Promise<Vault> {
  const vault = vaultAt(root, (step) => {
    if (step === 'vault staged') return // creating, not changing
    // The disk as a power cut at this moment would leave it.
    cpSync(vault.dir, join(snapshots, step, 'vault'), { recursive: true })
  })
  await vault.create(OLD)
  vault
    .database()
    .prepare(
      "INSERT INTO accounts (name, type, currency) VALUES ('Fake Bank', 'bank', 'AUD')",
    )
    .run()
  return vault
}

describe('changePassword', () => {
  it('re-encrypts into a new generation that only the new password opens', async () => {
    const vault = await vaultWithSnapshots()
    expect(await vault.changePassword(OLD, NEW)).toEqual({ ok: true })
    expect(vault.state).toBe('unlocked')
    expect(fakeAccounts(vault)).toEqual(['Fake Bank'])
    expect(files(vault)).toEqual(['ledger-2.db', 'vault.json'])

    await vault.lock()
    expect(await vault.unlock(OLD)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(await vault.unlock(NEW)).toEqual({ ok: true })
  })

  it('draws a new data key, so the old one opens nothing', async () => {
    const vault = await vaultWithSnapshots()
    await vault.changePassword(OLD, NEW)
    await vault.lock()
    const before = parseVaultFile(
      readFileSync(join(snapshots, 'copied', 'vault', 'vault.json'), 'utf8'),
    )
    if (!before) throw new Error('no snapshot')
    const oldKey = await openKey(before, OLD, deriveHere)
    if (!oldKey) throw new Error('old key did not open')
    expect(() => openDatabase(join(vault.dir, 'ledger-2.db'), oldKey)).toThrow(
      WrongKeyError,
    )
  })

  it('refuses a wrong current password and changes nothing', async () => {
    const vault = await vaultWithSnapshots()
    expect(await vault.changePassword(`${OLD}?`, NEW)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(files(vault)).toEqual(['ledger-1.db', 'vault.json'])
    expect(existsSync(join(snapshots, 'copied'))).toBe(false)
  })

  it('needs the vault unlocked', async () => {
    const vault = await vaultWithSnapshots()
    await vault.lock()
    expect(await vault.changePassword(OLD, NEW)).toEqual({
      ok: false,
      reason: 'locked',
    })
  })

  it('puts the vault back when a step fails without a crash', async () => {
    const vault = vaultAt(root, (step) => {
      if (step === 're-encrypted') throw new Error('disk full')
    })
    await vault.create(OLD)
    await expect(vault.changePassword(OLD, NEW)).rejects.toThrow('disk full')
    expect(vault.state).toBe('unlocked')
    expect(files(vault)).toEqual(['ledger-1.db', 'vault.json'])
    await vault.lock()
    expect(await vault.unlock(NEW)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(await vault.unlock(OLD)).toEqual({ ok: true })
  })
})

describe('a crash during changePassword', () => {
  beforeEach(async () => {
    const vault = await vaultWithSnapshots()
    await vault.changePassword(OLD, NEW)
  })

  it.each(STEPS)(
    'after "%s" leaves exactly one password working, with the data intact',
    async (step, works) => {
      const vault = vaultAt(join(snapshots, step))
      const fails = works === OLD ? NEW : OLD
      const leftBehind = files(vault)

      expect(vault.state).toBe('locked')
      expect(await vault.unlock(fails)).toEqual({
        ok: false,
        reason: 'wrong-password',
      })
      // Nothing is removed until the current generation has opened.
      expect(files(vault)).toEqual(leftBehind)

      expect(await vault.unlock(works)).toEqual({ ok: true })
      expect(fakeAccounts(vault)).toEqual(['Fake Bank'])
      const generation = works === OLD ? 1 : 2
      expect(files(vault)).toEqual([`ledger-${generation}.db`, 'vault.json'])
    },
  )

  it('after the commit, with the new database lost, is reported and nothing is deleted', async () => {
    const vault = vaultAt(join(snapshots, 'committed'))
    rmSync(join(vault.dir, 'ledger-2.db'))
    const leftBehind = files(vault)
    expect(leftBehind).toEqual(['ledger-1.db', 'vault.json'])

    expect(vault.state).toBe('damaged')
    expect(await vault.unlock(NEW)).toEqual({ ok: false, reason: 'damaged' })
    expect(await vault.unlock(OLD)).toEqual({ ok: false, reason: 'damaged' })
    expect(files(vault)).toEqual(leftBehind)
  })
})
