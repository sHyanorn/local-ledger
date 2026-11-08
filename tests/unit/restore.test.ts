import {
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
import { deriveHere } from '../../src/main/vault/kdf'
import type { KdfParams } from '../../src/main/vault/kdf'
import { openKey } from '../../src/main/vault/keys'
import { parseVaultFile } from '../../src/main/vault/vault-file'
import {
  REPLACED_PREFIX,
  Vault,
  type StagedBackup,
} from '../../src/main/vault/vault'

const FAST: KdfParams = { memoryKiB: 19_456, iterations: 2, parallelism: 1 }
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
    vault.database().pragma('user_version = 7')
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

describe('restoring at setup', () => {
  it('uses the backup password, and only where there is no vault', async () => {
    expect(await vault.restore(await check(vault), null)).toEqual({
      ok: false,
      reason: 'exists',
    })
    const fresh = open(newRoot())
    expect(fresh.state).toBe('new')
    expect(await fresh.restore(await check(fresh), null)).toEqual({ ok: true })
    expect(names(fresh)).toEqual(['Fake Backed Up'])
    fresh.lock()
    expect(await fresh.unlock(OLD)).toEqual({ ok: true })
    fresh.lock()
  })
})

describe('a crash during a restore', () => {
  it.each([
    ['restore staged', ['Fake Added Later', 'Fake Backed Up'], 0],
    ['vault moved aside', ['Fake Backed Up'], 1],
  ] as const)(
    'after "%s" leaves one whole vault that opens with the current password',
    async (step, expected, aside) => {
      const crashing = open(root, (at) => {
        if (at === step) throw new Error('crash')
      })
      vault.lock()
      expect(await crashing.unlock(NOW)).toEqual({ ok: true })
      const staged = await check(crashing)
      await expect(crashing.restore(staged, NOW)).rejects.toThrow('crash')
      crashing.lock()

      const restarted = open(root)
      expect(restarted.state).toBe('locked')
      expect(await restarted.unlock(NOW)).toEqual({ ok: true })
      expect(names(restarted)).toEqual(expected)
      expect(replaced(root)).toHaveLength(aside)
      restarted.lock()
    },
  )

  it('leaves no staged backup behind at the next start', async () => {
    const staged = await check(vault)
    expect(existsSync(staged.dir)).toBe(true)
    vault.lock()
    open(root)
    expect(existsSync(staged.dir)).toBe(false)
    mkdirSync(join(root, 'unrelated'))
    expect(existsSync(join(root, 'unrelated'))).toBe(true)
  })
})
