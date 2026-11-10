import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAccount } from '../../src/main/ledger/accounts'
import { openDatabase } from '../../src/main/vault/database'
import { openBackupKey, readBackup } from '../../src/main/vault/backup'
import { deriveHere, encodePassword } from '../../src/main/vault/kdf'
import { openKey } from '../../src/main/vault/keys'
import { parseVaultFile } from '../../src/main/vault/vault-file'
import {
  REPLACED_PREFIX,
  Vault,
  type StagedBackup,
} from '../../src/main/vault/vault'
import { FAST } from '../support/vault'

const OLD = 'fake passphrase when backed up'
const NOW = 'fake passphrase in use today'

let root: string
let vault: Vault
const roots: string[] = []
const newRoot = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-restore-'))
  roots.push(dir)
  return dir
}
const open = (dir: string, checkpoint?: (step: string) => void) =>
  new Vault(dir, { derive: deriveHere, kdf: FAST, checkpoint })
const account = (v: Vault, name: string) =>
  createAccount(v.database(), {
    name,
    type: 'bank',
    currency: 'AUD',
    openingBalanceCents: 0,
  })
const names = (v: Vault) =>
  v.database().prepare('SELECT name FROM accounts ORDER BY name').pluck().all()

/** A backup with one account, made under OLD; the vault then moves on under NOW. */
let backup: Buffer
beforeEach(async () => {
  root = newRoot()
  vault = open(root)
  await vault.create(OLD)
  account(vault, 'Fake Backed Up')
  const made = await vault.backup(OLD)
  if (!made.ok) throw new Error(made.reason)
  backup = made.file
  expect(await vault.changePassword(OLD, NOW)).toEqual({ ok: true })
  account(vault, 'Fake Added Later')
})
afterEach(() => {
  vault.lock()
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

async function check(v: Vault, password = OLD): Promise<StagedBackup> {
  const checked = await v.checkBackup(backup, password)
  if (!checked.ok) throw new Error(checked.reason)
  return checked.staged
}

const replaced = (dir: string) =>
  readdirSync(dir).filter((name) => name.startsWith(REPLACED_PREFIX))

describe('checking a backup', () => {
  it('says what it holds, and changes nothing', async () => {
    const staged = await check(vault)
    expect(staged.summary).toEqual({
      accounts: 1,
      transactions: 0,
      lastDate: null,
    })
    expect(names(vault)).toEqual(['Fake Added Later', 'Fake Backed Up'])
    vault.discardBackup(staged)
    expect(existsSync(staged.dir)).toBe(false)
    expect(staged.dataKey.every((byte) => byte === 0)).toBe(true)
  })

  it('refuses a wrong password, a file that is not a backup, and a newer schema', async () => {
    expect(await vault.checkBackup(backup, NOW)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(await vault.checkBackup(Buffer.from('nope'), OLD)).toEqual({
      ok: false,
      reason: 'invalid',
    })
    // A backup from a later version of the app.
    vault.database().pragma('user_version = 99')
    const made = await vault.backup(NOW)
    vault.database().pragma('user_version = 8')
    if (!made.ok) throw new Error(made.reason)
    expect(await vault.checkBackup(made.file, NOW)).toEqual({
      ok: false,
      reason: 'newer',
    })
    expect(
      readdirSync(root).filter((name) => name.startsWith('vault.')),
    ).toEqual([])
  })
})

describe('restoring from Settings', () => {
  it('keeps the current password, and moves the replaced vault aside', async () => {
    const staged = await check(vault)
    expect(await vault.restore(staged, 'not the fake passphrase')).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(names(vault)).toEqual(['Fake Added Later', 'Fake Backed Up'])

    expect(await vault.restore(staged, NOW)).toEqual({ ok: true })
    expect(names(vault)).toEqual(['Fake Backed Up'])
    vault.lock()
    expect(await vault.unlock(OLD)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(await vault.unlock(NOW)).toEqual({ ok: true })

    // The replaced vault is whole, and still opens with its password.
    const [aside] = replaced(root)
    expect(aside).toBeDefined()
    const file = parseVaultFile(
      readFileSync(join(root, aside!, 'vault.json'), 'utf8'),
    )!
    const key = await openKey(file, NOW, deriveHere)
    const old = openDatabase(
      join(root, aside!, `ledger-${file.generation}.db`),
      key!,
    )
    expect(
      old.prepare('SELECT name FROM accounts ORDER BY name').pluck().all(),
    ).toEqual(['Fake Added Later', 'Fake Backed Up'])
    old.close()
  })

  it('needs the vault open', async () => {
    const staged = await check(vault)
    vault.lock()
    expect(await vault.restore(staged, NOW)).toEqual({
      ok: false,
      reason: 'locked',
    })
    expect(replaced(root)).toEqual([])
  })
})

describe('restoring with the backup password', () => {
  it('needs no vault open: an open one is replaced only with its password', async () => {
    expect(await vault.restore(await check(vault), null)).toEqual({
      ok: false,
      reason: 'exists',
    })
    expect(names(vault)).toEqual(['Fake Added Later', 'Fake Backed Up'])
    expect(replaced(root)).toEqual([])
  })

  it('makes the vault where there is none', async () => {
    const fresh = open(newRoot())
    expect(fresh.state).toBe('new')
    expect(await fresh.restore(await check(fresh), null)).toEqual({ ok: true })
    expect(names(fresh)).toEqual(['Fake Backed Up'])
    fresh.lock()
    expect(await fresh.unlock(OLD)).toEqual({ ok: true })
    fresh.lock()
  })

  it('replaces a locked vault, which is moved aside and still opens with its password', async () => {
    vault.lock()
    expect(vault.state).toBe('locked')
    const states: string[] = []
    vault.onChange((state) => states.push(state))
    expect(await vault.restore(await check(vault), null)).toEqual({ ok: true })
    expect(states).toEqual(['unlocked'])
    expect(names(vault)).toEqual(['Fake Backed Up'])
    vault.lock()
    expect(await vault.unlock(NOW)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(await vault.unlock(OLD)).toEqual({ ok: true })
    vault.lock()

    const [aside] = replaced(root)
    expect(replaced(root)).toHaveLength(1)
    const old = open(newRoot())
    cpSync(join(root, aside!), old.dir, { recursive: true })
    expect(await old.unlock(OLD)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(await old.unlock(NOW)).toEqual({ ok: true })
    expect(names(old)).toEqual(['Fake Added Later', 'Fake Backed Up'])
    old.lock()
  })
})

describe('a crash during a restore', () => {
  it.each([
    ['restore staged', ['Fake Added Later', 'Fake Backed Up'], 0],
    ['vault moved aside', ['Fake Backed Up'], 1],
  ] as const)(
    'after "%s" leaves one whole vault that opens with the current password',
    async (step, expected, aside) => {
      // The disk as a crash at that step would leave it.
      const disk = newRoot()
      const crashing = open(root, (at) => {
        if (at === step) cpSync(root, disk, { recursive: true })
      })
      vault.lock()
      expect(await crashing.unlock(NOW)).toEqual({ ok: true })
      expect(await crashing.restore(await check(crashing), NOW)).toEqual({
        ok: true,
      })
      crashing.lock()

      const restarted = open(disk)
      expect(restarted.state).toBe('locked')
      expect(await restarted.unlock(NOW)).toEqual({ ok: true })
      expect(names(restarted)).toEqual(expected)
      expect(replaced(disk)).toHaveLength(aside)
      restarted.lock()
    },
  )

  it('leaves no staged backup behind at the next start', async () => {
    mkdirSync(join(root, 'unrelated'))
    const staged = await check(vault)
    expect(existsSync(staged.dir)).toBe(true)
    vault.lock()
    open(root)
    expect(existsSync(staged.dir)).toBe(false)
    expect(existsSync(join(root, 'unrelated'))).toBe(true)
  })
})

describe('a restore that fails part way', () => {
  it('puts the vault back and keeps it open', async () => {
    const failing = open(root, (at) => {
      if (at === 'vault moved aside') throw new Error('rename refused')
    })
    vault.lock()
    expect(await failing.unlock(NOW)).toEqual({ ok: true })
    const states: string[] = []
    failing.onChange((state) => states.push(state))
    await expect(failing.restore(await check(failing), NOW)).rejects.toThrow(
      'rename refused',
    )
    expect(failing.unlocked).toBe(true)
    expect(states).toEqual(['unlocked'])
    expect(names(failing)).toEqual(['Fake Added Later', 'Fake Backed Up'])
    expect(replaced(root)).toEqual([])
    failing.lock()
  })

  it('cannot be spoiled by wiping the staged key while it runs', async () => {
    const staged = await check(vault)
    const restoring = vault.restore(staged, NOW)
    // As a discard from the page would, between the two key derivations.
    staged.dataKey.fill(0)
    expect(await restoring).toEqual({ ok: true })
    expect(names(vault)).toEqual(['Fake Backed Up'])
  })
})

describe('the restored vault', () => {
  it('has a data key of its own, which neither the backup nor an old vault.json opens', async () => {
    const before = readFileSync(join(root, 'vault', 'vault.json'), 'utf8')
    expect(await vault.restore(await check(vault), NOW)).toEqual({ ok: true })
    account(vault, 'Fake Added After Restore')
    vault.lock()
    const file = parseVaultFile(
      readFileSync(join(root, 'vault', 'vault.json'), 'utf8'),
    )!
    const live = join(root, 'vault', `ledger-${file.generation}.db`)
    const backupKey = await openKey(
      { ...parseVaultFile(before)!, generation: 2 },
      NOW,
      deriveHere,
    )
    // Old keys: the backup's (under OLD) and the vault's before the restore.
    const read = readBackup(backup)!
    const sealing = await deriveHere(
      encodePassword(OLD),
      read.header.kdf.salt,
      read.header.kdf,
    )
    for (const key of [openBackupKey(read.header, sealing), backupKey]) {
      expect(key).not.toBeNull()
      expect(() => openDatabase(live, key!)).toThrow()
    }
  })

  it('can replace a vault that does not open, without its password', async () => {
    vault.lock()
    const staged = await check(open(newRoot()))
    rmSync(join(root, 'vault', 'vault.json'))
    const damaged = open(root)
    expect(damaged.state).toBe('damaged')
    expect(await damaged.restore(staged, null)).toEqual({ ok: true })
    expect(names(damaged)).toEqual(['Fake Backed Up'])
    expect(replaced(root)).toHaveLength(1)
    damaged.lock()
  })
})
