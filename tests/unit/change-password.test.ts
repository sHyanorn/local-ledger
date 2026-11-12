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
import { DamagedError, openDatabase } from '../../src/main/vault/database'
import { deriveHere } from '../../src/main/vault/kdf'
import { openKey } from '../../src/main/vault/keys'
import { parseVaultFile } from '../../src/main/vault/vault-file'
import { Vault } from '../../src/main/vault/vault'
import type { VaultState } from '../../src/shared/ipc'
import { corruptVaultIndex } from '../support/corrupt'
import { FAST, OLD, NEW } from '../support/vault'

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
  for (const vault of open.splice(0)) vault.lock()
  rmSync(root, { recursive: true, force: true })
  rmSync(snapshots, { recursive: true, force: true })
})

/** A vault with fake data, whose checkpoint copies the disk at every step. */
async function vaultWithSnapshots(): Promise<Vault> {
  const vault = vaultAt(root, (step) => {
    if (step === 'vault staged') return // creating, not changing
    // The files as a crash of the app at this moment would leave them.
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

    vault.lock()
    expect(await vault.unlock(OLD)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(await vault.unlock(NEW)).toEqual({ ok: true })
  })

  it('draws a new data key, so the old one opens nothing', async () => {
    const vault = await vaultWithSnapshots()
    await vault.changePassword(OLD, NEW)
    vault.lock()
    const before = parseVaultFile(
      readFileSync(join(snapshots, 'copied', 'vault', 'vault.json'), 'utf8'),
    )
    if (!before) throw new Error('no snapshot')
    const oldKey = await openKey(before, OLD, deriveHere)
    if (!oldKey) throw new Error('old key did not open')
    expect(() => openDatabase(join(vault.dir, 'ledger-2.db'), oldKey)).toThrow(
      DamagedError,
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
    vault.lock()
    expect(await vault.changePassword(OLD, NEW)).toEqual({
      ok: false,
      reason: 'locked',
    })
  })

  // Derivation 1 created the vault; 2 opens the old key, 3 seals the new one.
  it.each([
    [2, 'the old key', 2],
    [3, 'the new key', 3],
  ])(
    'is cancelled by a lock during derivation %i (%s); the lock closes the database at once',
    async (lockAt, _key, derivedInAll) => {
      let derivations = 0
      const vault: Vault = new Vault(root, {
        kdf: FAST,
        derive: (...args) => {
          if (++derivations === lockAt) {
            const db = vault.database()
            vault.lock()
            expect(db.open).toBe(false)
          }
          return deriveHere(...args)
        },
      })
      open.push(vault)
      await vault.create(OLD)
      expect(await vault.changePassword(OLD, NEW)).toEqual({
        ok: false,
        reason: 'locked',
      })
      // A lock during the first derivation skips the second.
      expect(derivations).toBe(derivedInAll)
      expect(files(vault)).toEqual(['ledger-1.db', 'vault.json'])
      expect(await vault.unlock(OLD)).toEqual({ ok: true })
    },
  )

  it('never commits a copy that fails integrity_check', async () => {
    const vault = vaultAt(root)
    await vault.create(OLD)
    vault.lock()
    await corruptVaultIndex(vault, OLD)
    expect(await vault.unlock(OLD)).toEqual({ ok: true })
    const seen: VaultState[] = []
    vault.onChange((state) => seen.push(state))
    await expect(vault.changePassword(OLD, NEW)).rejects.toThrow(
      'integrity_check',
    )
    expect(vault.state).toBe('unlocked')
    // The page stays, to say the change failed.
    expect(seen).toEqual([])
    expect(files(vault)).toEqual(['ledger-1.db', 'vault.json'])
  })
})

describe('a failure during changePassword, without a crash', () => {
  it.each(STEPS)(
    'right after "%s" leaves the vault open with the password that works there',
    async (step, works) => {
      const committed = works === NEW
      let armed = true
      const vault = vaultAt(root, (at) => {
        if (armed && at === step) {
          armed = false
          throw new Error('disk error')
        }
      })
      await vault.create(OLD)
      vault
        .database()
        .prepare(
          "INSERT INTO accounts (name, type, currency) VALUES ('Fake Bank', 'bank', 'AUD')",
        )
        .run()
      const seen: VaultState[] = []
      vault.onChange((state) => seen.push(state))
      const changing = vault.changePassword(OLD, NEW)
      // Before the commit the change fails and the page stays to say so;
      // after it the change stands and the page is replaced.
      if (committed) expect(await changing).toEqual({ ok: true })
      else await expect(changing).rejects.toThrow('disk error')
      expect(seen).toEqual(committed ? ['unlocked'] : [])
      expect(vault.state).toBe('unlocked')
      expect(fakeAccounts(vault)).toEqual(['Fake Bank'])
      // After a failure the old generation stays until the next unlock.
      expect(files(vault)).toEqual(
        committed
          ? ['ledger-1.db', 'ledger-2.db', 'vault.json']
          : ['ledger-1.db', 'vault.json'],
      )

      vault.lock()
      const fails = works === OLD ? NEW : OLD
      expect(await vault.unlock(fails)).toEqual({
        ok: false,
        reason: 'wrong-password',
      })
      expect(await vault.unlock(works)).toEqual({ ok: true })
      expect(fakeAccounts(vault)).toEqual(['Fake Bank'])
      const generation = works === OLD ? 1 : 2
      expect(files(vault)).toEqual([`ledger-${generation}.db`, 'vault.json'])
    },
  )

  it('with vault.json unreadable afterwards, stays locked and deletes nothing', async () => {
    const vault = vaultAt(root, (step) => {
      if (step !== 'renamed') return
      rmSync(join(vault.dir, 'vault.json'))
      throw new Error('disk error')
    })
    await vault.create(OLD)
    const seen: VaultState[] = []
    vault.onChange((state) => seen.push(state))
    await expect(vault.changePassword(OLD, NEW)).rejects.toThrow('disk error')
    expect(vault.state).toBe('damaged')
    // The page that showed the vault open is replaced.
    expect(seen).toEqual(['damaged'])
    expect(files(vault)).toEqual(['ledger-1.db', 'ledger-2.db'])
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
