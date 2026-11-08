// Every key buffer the vault handles is zero once an operation returns,
// whether it succeeded, failed or was cancelled.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Derive } from '../../src/main/vault/kdf'

const seen = vi.hoisted(() => ({ keys: [] as Uint8Array[], sealFails: false }))

// Data keys as they come out of vault.json, and new ones.
vi.mock('../../src/main/vault/envelope', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/main/vault/envelope')>()
  return {
    ...actual,
    seal: (...args: Parameters<typeof actual.seal>) => {
      if (!seen.sealFails) return actual.seal(...args)
      seen.keys.push(args[1])
      throw new Error('cipher failed')
    },
    open: (...args: Parameters<typeof actual.open>) => {
      const key = actual.open(...args)
      if (key) seen.keys.push(key)
      return key
    },
  }
})
vi.mock('../../src/main/vault/keys', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/main/vault/keys')>()
  return {
    ...actual,
    createKey: async (...args: Parameters<typeof actual.createKey>) => {
      const created = await actual.createKey(...args)
      seen.keys.push(created.dataKey)
      return created
    },
  }
})

const { deriveHere } = await import('../../src/main/vault/kdf')
const { Vault } = await import('../../src/main/vault/vault')

const FAST = { memoryKiB: 19_456, iterations: 2, parallelism: 1 }
const OLD = 'old fake ledger passphrase'
const NEW = 'new fake ledger passphrase'
let root: string
let failDerivation = 0

/** Sealing keys, and a way to fail the nth derivation. */
const derive: Derive = async (...args) => {
  if (--failDerivation === 0) throw new Error('worker ran out of memory')
  const key = await deriveHere(...args)
  seen.keys.push(key)
  return key
}

const expectAllWiped = (count: number) => {
  expect(seen.keys).toHaveLength(count)
  for (const key of seen.keys)
    expect(key.every((byte) => byte === 0)).toBe(true)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ledger-wipe-'))
  failDerivation = 0
  // The raw key literals handed to SQLite.
  for (const method of ['key', 'rekey'] as const) {
    const original = Database.prototype[method]
    vi.spyOn(Database.prototype, method).mockImplementation(function (
      this: Database.Database,
      literal: Buffer,
    ) {
      seen.keys.push(literal)
      return original.call(this, literal)
    })
  }
})
afterEach(() => {
  vi.restoreAllMocks()
  seen.keys = []
  seen.sealFails = false
  rmSync(root, { recursive: true, force: true })
})

it('after create, unlock and a wrong password', async () => {
  const vault = new Vault(root, { derive, kdf: FAST })
  await vault.create(OLD)
  // Sealing key, data key, literals for the staged and the opened database.
  expectAllWiped(4)
  vault.lock()
  seen.keys = []
  await vault.unlock(`${OLD}?`)
  expectAllWiped(1)
  await vault.unlock(OLD)
  expectAllWiped(4)
  vault.lock()
})

it('after a password change, and after one that failed', async () => {
  let armed = false
  const vault = new Vault(root, {
    derive,
    kdf: FAST,
    checkpoint: (step) => {
      if (armed && step === 're-encrypted') throw new Error('disk full')
    },
  })
  await vault.create(OLD)
  seen.keys = []
  expect(await vault.changePassword(OLD, NEW)).toEqual({ ok: true })
  // Two sealing keys, both data keys, literals for the copy, the rekey and
  // the new generation.
  expectAllWiped(7)

  seen.keys = []
  armed = true
  await expect(vault.changePassword(NEW, OLD)).rejects.toThrow('disk full')
  // The same, with the old generation reopened in place of the new one.
  expectAllWiped(7)
  vault.lock()
})

it('after a password change whose second derivation failed', async () => {
  const vault = new Vault(root, { derive, kdf: FAST })
  await vault.create(OLD)
  seen.keys = []
  failDerivation = 2
  await expect(vault.changePassword(OLD, NEW)).rejects.toThrow('out of memory')
  // The first sealing key and the old data key.
  expectAllWiped(2)
  expect(vault.state).toBe('unlocked')
  vault.lock()
})

it('after an unlock that a lock cancelled', async () => {
  const vault = new Vault(root, { derive, kdf: FAST })
  await vault.create(OLD)
  vault.lock()
  seen.keys = []
  const unlocking = vault.unlock(OLD)
  vault.lock()
  expect(await unlocking).toEqual({ ok: false, reason: 'locked' })
  expectAllWiped(2)
})

it('after a create whose sealing failed', async () => {
  const vault = new Vault(root, { derive, kdf: FAST })
  seen.sealFails = true
  await expect(vault.create(OLD)).rejects.toThrow('cipher failed')
  // The sealing key and the data key it was to seal.
  expectAllWiped(2)
})
