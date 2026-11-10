// The key buffers of creating, unlocking, changing the password and checking
// a backup are zero once the operation returns, whether it succeeded,
// failed or was cancelled. Each buffer is recorded with where it came from.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Derive } from '../../src/main/vault/kdf'
import { FAST, OLD, NEW } from '../support/vault'

/**
 * derived: a sealing key; unsealed: a data key opened from a vault file or
 * a backup; created: a new data key; sealed: a key given to a seal that
 * failed; drawn: a fresh random key; literal: a raw key handed to SQLite.
 */
type Source =
  'derived' | 'unsealed' | 'created' | 'sealed' | 'drawn' | 'literal'

const seen = vi.hoisted(() => ({
  keys: [] as { source: string; key: Uint8Array }[],
  sealFails: false,
  /** Also record new random keys, such as the one a backup check draws. */
  randomKeys: false,
  /** Results for the next integrity checks, in order; empty runs them. */
  integrity: [] as boolean[],
}))

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  const fill = actual.randomFillSync as (...args: unknown[]) => Buffer
  return {
    ...actual,
    randomFillSync: ((...args: unknown[]) => {
      const filled = fill(...args)
      if (seen.randomKeys && filled.length === 32)
        seen.keys.push({ source: 'drawn', key: filled })
      return filled
    }) as typeof actual.randomFillSync,
  }
})
vi.mock('../../src/main/vault/database', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/main/vault/database')>()
  return {
    ...actual,
    passesIntegrityCheck: (
      db: Parameters<typeof actual.passesIntegrityCheck>[0],
    ) => seen.integrity.shift() ?? actual.passesIntegrityCheck(db),
  }
})

// Data keys as they come out of vault.json, and new ones.
vi.mock('../../src/main/vault/envelope', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/main/vault/envelope')>()
  return {
    ...actual,
    seal: (...args: Parameters<typeof actual.seal>) => {
      if (!seen.sealFails) return actual.seal(...args)
      seen.keys.push({ source: 'sealed', key: args[1] })
      throw new Error('cipher failed')
    },
    open: (...args: Parameters<typeof actual.open>) => {
      const key = actual.open(...args)
      if (key) seen.keys.push({ source: 'unsealed', key })
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
      seen.keys.push({ source: 'created', key: created.dataKey })
      return created
    },
  }
})

const { deriveHere } = await import('../../src/main/vault/kdf')
const { Vault } = await import('../../src/main/vault/vault')

let root: string
let failDerivation = 0
let duringDerivation: (() => void) | null = null

/** Sealing keys, a way to fail the nth derivation, and a hook into one. */
const derive: Derive = async (...args) => {
  if (--failDerivation === 0) throw new Error('worker ran out of memory')
  duringDerivation?.()
  const key = await deriveHere(...args)
  seen.keys.push({ source: 'derived', key })
  return key
}

/** Keys came from each of these sources and no other, and all are zero. */
const expectAllWiped = (...sources: Source[]) => {
  expect(new Set(seen.keys.map(({ source }) => source))).toEqual(
    new Set(sources),
  )
  for (const { source, key } of seen.keys)
    expect(
      key.every((byte) => byte === 0),
      source,
    ).toBe(true)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ledger-wipe-'))
  failDerivation = 0
  duringDerivation = null
  // The raw key literals handed to SQLite.
  for (const method of ['key', 'rekey'] as const) {
    const original = Database.prototype[method]
    vi.spyOn(Database.prototype, method).mockImplementation(function (
      this: Database.Database,
      literal: Buffer,
    ) {
      seen.keys.push({ source: 'literal', key: literal })
      return original.call(this, literal)
    })
  }
})
afterEach(() => {
  vi.restoreAllMocks()
  seen.keys = []
  seen.sealFails = false
  seen.randomKeys = false
  seen.integrity = []
  rmSync(root, { recursive: true, force: true })
})

it('after create, unlock and a wrong password', async () => {
  const vault = new Vault(root, { derive, kdf: FAST })
  await vault.create(OLD)
  expectAllWiped('derived', 'created', 'literal')
  vault.lock()
  seen.keys = []
  await vault.unlock(`${OLD}?`)
  expectAllWiped('derived')
  await vault.unlock(OLD)
  expectAllWiped('derived', 'unsealed', 'literal')
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
  expectAllWiped('derived', 'unsealed', 'created', 'literal')

  seen.keys = []
  armed = true
  await expect(vault.changePassword(NEW, OLD)).rejects.toThrow('disk full')
  // The same, with the old generation reopened in place of the new one.
  expectAllWiped('derived', 'unsealed', 'created', 'literal')
  vault.lock()
})

it('after a password change whose second derivation failed', async () => {
  const vault = new Vault(root, { derive, kdf: FAST })
  await vault.create(OLD)
  seen.keys = []
  failDerivation = 2
  await expect(vault.changePassword(OLD, NEW)).rejects.toThrow('out of memory')
  // The first sealing key and the old data key.
  expectAllWiped('derived', 'unsealed')
  expect(vault.state).toBe('unlocked')
  vault.lock()
})

it('after an unlock that a lock cancelled', async () => {
  const vault = new Vault(root, { derive, kdf: FAST })
  await vault.create(OLD)
  vault.lock()
  seen.keys = []
  duringDerivation = () => vault.lock()
  expect(await vault.unlock(OLD)).toEqual({ ok: false, reason: 'locked' })
  // The sealing key and the data key it opened.
  expectAllWiped('derived', 'unsealed')
})

it('after a create whose sealing failed', async () => {
  const vault = new Vault(root, { derive, kdf: FAST })
  seen.sealFails = true
  await expect(vault.create(OLD)).rejects.toThrow('cipher failed')
  // The sealing key and the data key it was to seal.
  expectAllWiped('derived', 'sealed')
})

it('after a backup check whose integrity check failed once the copy was rekeyed', async () => {
  const vault = new Vault(root, { derive, kdf: FAST })
  await vault.create(OLD)
  const made = await vault.backup(OLD)
  if (!made.ok) throw new Error(made.reason)
  vault.lock()
  seen.keys = []
  seen.randomKeys = true
  seen.integrity = [true, false]
  expect(await vault.checkBackup(made.file, OLD)).toEqual({
    ok: false,
    reason: 'damaged',
  })
  // The sealing key, the backup's data key, the literals that opened and
  // rekeyed its copy, and the fresh key.
  expectAllWiped('derived', 'unsealed', 'literal', 'drawn')
})
