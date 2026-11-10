// File system failures after a commit point: once vault.json or the vault
// directory has been renamed into place, nothing that follows undoes it.
import { mkdtempSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FAST, OLD, NEW } from '../support/vault'

const failing = vi.hoisted(() => ({ flushes: 0, listing: false }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const fail = (code: string) =>
    Object.assign(new Error(`${code}: simulated`), { code })
  // syncDirectory opens the directory read-only.
  const openSync: typeof actual.openSync = (path, flags, mode) => {
    if (failing.flushes > 0 && flags === 'r') {
      failing.flushes--
      throw fail('EIO')
    }
    return actual.openSync(path, flags, mode)
  }
  const readdirSync = ((...args: Parameters<typeof actual.readdirSync>) => {
    if (failing.listing) {
      failing.listing = false
      throw fail('EMFILE')
    }
    return actual.readdirSync(...args)
  }) as typeof actual.readdirSync
  const fs = { ...actual, openSync, readdirSync }
  return { ...fs, default: fs }
})

const { deriveHere } = await import('../../src/main/vault/kdf')
const { Vault } = await import('../../src/main/vault/vault')

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ledger-flush-'))
})
afterEach(() => {
  failing.flushes = 0
  failing.listing = false
  rmSync(root, { recursive: true, force: true })
})

/** A vault that sets up a failure when it reaches the named step. */
const vaultFailingAt = (step: string, arm: () => void) =>
  new Vault(root, {
    derive: deriveHere,
    kdf: FAST,
    checkpoint: (at) => {
      if (at === step) arm()
    },
  })

const files = (dir: string) => readdirSync(dir).sort()

/** Open descriptors of this process on a file; Linux only. */
const handles = (name: string) =>
  readdirSync('/proc/self/fd').filter((fd) => {
    try {
      return readlinkSync(`/proc/self/fd/${fd}`).endsWith(name)
    } catch {
      return false
    }
  }).length

it.skipIf(process.platform === 'win32')(
  'unflushed commit: the new password works, and the old generation stays until a flush succeeds',
  async () => {
    // Every directory flush fails from here until the test lets them work.
    const vault = vaultFailingAt('temporary file written', () => {
      failing.flushes = Infinity
    })
    await vault.create(OLD)
    expect(await vault.changePassword(OLD, NEW)).toEqual({ ok: true })
    expect(vault.state).toBe('unlocked')
    expect(files(vault.dir)).toEqual([
      'ledger-1.db',
      'ledger-2.db',
      'vault.json',
    ])
    vault.lock()
    expect(await vault.unlock(OLD)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    // A flush still fails at this unlock: still nothing is deleted.
    expect(await vault.unlock(NEW)).toEqual({ ok: true })
    expect(files(vault.dir)).toEqual([
      'ledger-1.db',
      'ledger-2.db',
      'vault.json',
    ])
    failing.flushes = 0
    vault.lock()
    expect(await vault.unlock(NEW)).toEqual({ ok: true })
    expect(files(vault.dir)).toEqual(['ledger-2.db', 'vault.json'])
    vault.lock()
  },
)

it('a failure to list the directory after the commit: the change stands, on one connection', async () => {
  const vault = vaultFailingAt('committed', () => {
    failing.listing = true
  })
  await vault.create(OLD)
  expect(await vault.changePassword(OLD, NEW)).toEqual({ ok: true })
  expect(vault.state).toBe('unlocked')
  if (process.platform === 'linux') expect(handles('ledger-2.db')).toBe(1)
  vault.lock()
  if (process.platform === 'linux') expect(handles('ledger-2.db')).toBe(0)
  expect(await vault.unlock(NEW)).toEqual({ ok: true })
  vault.lock()
})

it.skipIf(process.platform === 'win32')(
  'creating: a staging directory that cannot be flushed puts no vault in place',
  async () => {
    // The first directory flush is the staging directory's, for vault.json.
    const vault = new Vault(root, { derive: deriveHere, kdf: FAST })
    failing.flushes = 1
    await expect(vault.create(OLD)).rejects.toThrow('could not be flushed')
    expect(vault.state).toBe('new')
    expect(await vault.create(OLD)).toEqual({ ok: true })
    vault.lock()
  },
)

it.skipIf(process.platform === 'win32')(
  'creating: a flush that fails after the vault is in place does not fail the create',
  async () => {
    const vault = vaultFailingAt('vault staged', () => {
      failing.flushes = 1
    })
    expect(await vault.create(OLD)).toEqual({ ok: true })
    expect(vault.state).toBe('unlocked')
    vault.lock()
  },
)
