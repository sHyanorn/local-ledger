// A rekeyed copy is checked as it is on disk. The connection that rekeyed
// it holds every page in its cache and answers integrity_check from there,
// so a page that reached the file otherwise would pass.
import {
  closeSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createAccount } from '../../src/main/ledger/accounts'
import type { Db } from '../../src/main/vault/database'
import { deriveHere } from '../../src/main/vault/kdf'
import { RESTORING_PREFIX } from '../../src/main/vault/layout'
import { parseVaultFile } from '../../src/main/vault/vault-file'
import { Vault } from '../../src/main/vault/vault'
import { FAST, NEW, OLD } from '../support/vault'

const damage = vi.hoisted(() => ({ on: false }))

// After the real rekey, page 2 of the file changes behind SQLite's back, as
// a write lost or altered on its way to the disk would leave it.
vi.mock('../../src/main/vault/database', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/main/vault/database')>()
  return {
    ...actual,
    changeKey: (db: Db, key: Uint8Array) => {
      actual.changeKey(db, key)
      if (!damage.on) return
      const size = db.pragma('page_size', { simple: true }) as number
      const page = Buffer.alloc(size)
      const fd = openSync(db.name, 'r+')
      try {
        readSync(fd, page, 0, size, size)
        writeSync(
          fd,
          page.map((byte) => byte ^ 0x5a),
          0,
          size,
          size,
        )
      } finally {
        closeSync(fd)
      }
    },
  }
})

const roots: string[] = []
afterEach(() => {
  damage.on = false
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

async function vaultWithAccounts(): Promise<{ root: string; vault: Vault }> {
  const root = mkdtempSync(join(tmpdir(), 'ledger-rekey-'))
  roots.push(root)
  const vault = new Vault(root, { derive: deriveHere, kdf: FAST })
  await vault.create(OLD)
  for (let n = 0; n < 50; n++) {
    createAccount(vault.database(), {
      name: `Fake Account ${n}`,
      type: 'bank',
      currency: 'AUD',
      openingBalanceCents: 0,
    })
  }
  return { root, vault }
}

it('a password change fails before it commits when the re-encrypted file is damaged', async () => {
  const { root, vault } = await vaultWithAccounts()
  damage.on = true
  await expect(vault.changePassword(OLD, NEW)).rejects.toThrow(
    'integrity_check',
  )
  const file = readFileSync(join(root, 'vault', 'vault.json'), 'utf8')
  expect(parseVaultFile(file)?.generation).toBe(1)
  expect(vault.unlocked).toBe(true)
  vault.lock()
  expect(await vault.unlock(OLD)).toEqual({ ok: true })
  vault.lock()
})

it('a backup whose staged copy is damaged by its rekey is refused', async () => {
  const { root, vault } = await vaultWithAccounts()
  const made = await vault.backup(OLD)
  if (!made.ok) throw new Error(made.reason)
  damage.on = true
  expect(await vault.checkBackup(made.file, OLD)).toEqual({
    ok: false,
    reason: 'damaged',
  })
  expect(
    readdirSync(root).filter((name) => name.startsWith(RESTORING_PREFIX)),
  ).toEqual([])
  vault.lock()
})
