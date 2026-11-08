// A directory that cannot be flushed after vault.json was renamed into
// place: the change has committed, so it must not be undone.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const failing = vi.hoisted(() => ({ next: false }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  // syncDirectory opens the directory read-only; fail the next such open.
  const openSync: typeof actual.openSync = (path, flags, mode) => {
    if (failing.next && flags === 'r') {
      failing.next = false
      throw Object.assign(new Error('EIO: i/o error, open'), { code: 'EIO' })
    }
    return actual.openSync(path, flags, mode)
  }
  return { ...actual, default: { ...actual, openSync }, openSync }
})

const { deriveHere } = await import('../../src/main/vault/kdf')
const { Vault } = await import('../../src/main/vault/vault')

const FAST = { memoryKiB: 19_456, iterations: 2, parallelism: 1 }
const OLD = 'old fake ledger passphrase'
const NEW = 'new fake ledger passphrase'
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ledger-flush-'))
})
afterEach(() => {
  failing.next = false
  rmSync(root, { recursive: true, force: true })
})

/** A vault whose next directory flush after the named step fails. */
const vaultFailingAfter = (step: string) =>
  new Vault(root, {
    derive: deriveHere,
    kdf: FAST,
    checkpoint: (at) => {
      if (at === step) failing.next = true
    },
  })

it.skipIf(process.platform === 'win32')(
  'after the commit: the new password works and the old generation is kept until the next unlock',
  async () => {
    const vault = vaultFailingAfter('temporary file written')
    await vault.create(OLD)
    expect(await vault.changePassword(OLD, NEW)).toEqual({ ok: true })
    expect(vault.state).toBe('unlocked')
    expect(readdirSync(vault.dir).sort()).toEqual([
      'ledger-1.db',
      'ledger-2.db',
      'vault.json',
    ])
    vault.lock()
    expect(await vault.unlock(OLD)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(await vault.unlock(NEW)).toEqual({ ok: true })
    expect(readdirSync(vault.dir).sort()).toEqual(['ledger-2.db', 'vault.json'])
    vault.lock()
  },
)

it.skipIf(process.platform === 'win32')(
  'while creating: no vault is put in place',
  async () => {
    // Creating writes vault.json into the staging directory first.
    const vault = new Vault(root, { derive: deriveHere, kdf: FAST })
    failing.next = true
    await expect(vault.create(OLD)).rejects.toThrow('could not be flushed')
    expect(vault.state).toBe('new')
    expect(await vault.create(OLD)).toEqual({ ok: true })
    vault.lock()
  },
)
