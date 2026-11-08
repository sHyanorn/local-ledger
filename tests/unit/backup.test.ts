import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAccount } from '../../src/main/ledger/accounts'
import {
  openBackupKey,
  readBackup,
  type ReadBackup,
} from '../../src/main/vault/backup'
import { openDatabase } from '../../src/main/vault/database'
import { deriveHere, encodePassword } from '../../src/main/vault/kdf'
import type { KdfParams } from '../../src/main/vault/kdf'
import { Vault } from '../../src/main/vault/vault'

const FAST: KdfParams = { memoryKiB: 19_456, iterations: 2, parallelism: 1 }
const PASSWORD = 'fake ledger passphrase for tests'

let root: string
let vault: Vault
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ledger-backup-'))
  vault = new Vault(root, { derive: deriveHere, kdf: FAST })
  expect(await vault.create(PASSWORD)).toEqual({ ok: true })
  createAccount(vault.database(), {
    name: 'Fake Everyday',
    type: 'bank',
    currency: 'AUD',
    openingBalanceCents: 12_345,
  })
})
afterEach(() => {
  vault.lock()
  rmSync(root, { recursive: true, force: true })
})

async function backup(): Promise<Buffer> {
  const made = await vault.backup(PASSWORD)
  if (!made.ok) throw new Error(made.reason)
  return made.file
}

/** The data key from a backup, opened with the password. */
async function dataKey(read: ReadBackup, password = PASSWORD) {
  const sealing = await deriveHere(
    encodePassword(password),
    read.header.kdf.salt,
    read.header.kdf,
  )
  return openBackupKey(read.header, sealing)
}

describe('backup', () => {
  it('holds the encrypted database and opens with the password', async () => {
    const file = await backup()
    expect(file.subarray(0, 8).toString()).toBe('LLBACKUP')
    // The database inside is encrypted: no plaintext SQLite header or names.
    expect(file.includes(Buffer.from('SQLite format 3'))).toBe(false)
    expect(file.includes(Buffer.from('Fake Everyday'))).toBe(false)
    const read = readBackup(file)
    expect(read?.header.schema).toBeGreaterThanOrEqual(7)
    const key = await dataKey(read!)
    expect(key).not.toBeNull()
    expect(await dataKey(read!, 'not the fake passphrase')).toBeNull()

    const path = join(root, 'restored.db')
    writeFileSync(path, read!.database)
    const db = openDatabase(path, key!)
    expect(db.prepare('SELECT name FROM accounts').pluck().all()).toEqual([
      'Fake Everyday',
    ])
    db.close()
  })

  it('needs the current password, and the vault open', async () => {
    expect(await vault.backup('not the fake passphrase')).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    vault.lock()
    expect(await vault.backup(PASSWORD)).toEqual({
      ok: false,
      reason: 'locked',
    })
  })

  it('refuses a cut, altered or mixed file', async () => {
    const file = await backup()
    const start = 12 + file.readUInt32BE(8)
    // One byte of the database.
    const altered = Buffer.from(file)
    altered[start + 100]! ^= 1
    expect(readBackup(altered)).toBeNull()
    // Cut short, or with something added.
    expect(readBackup(file.subarray(0, file.length - 1))).toBeNull()
    expect(readBackup(Buffer.concat([file, Buffer.from([0])]))).toBeNull()
    expect(readBackup(file.subarray(0, 10))).toBeNull()
    expect(readBackup(Buffer.from('not a backup at all'))).toBeNull()

    // A database from another backup, with the header's hash and size
    // changed to match: the key no longer opens.
    createAccount(vault.database(), {
      name: 'Fake Savings',
      type: 'savings',
      currency: 'AUD',
      openingBalanceCents: 0,
    })
    const other = await backup()
    const otherDatabase = other.subarray(12 + other.readUInt32BE(8))
    const header = JSON.parse(file.subarray(12, start).toString())
    const { createHash } = await import('node:crypto')
    header.size = otherDatabase.length
    header.sha256 = createHash('sha256').update(otherDatabase).digest('base64')
    const json = Buffer.from(JSON.stringify(header))
    const length = Buffer.alloc(4)
    length.writeUInt32BE(json.length)
    const mixed = Buffer.concat([
      Buffer.from('LLBACKUP'),
      length,
      json,
      otherDatabase,
    ])
    const read = readBackup(mixed)
    expect(read).not.toBeNull()
    expect(await dataKey(read!)).toBeNull()

    // A changed schema version or Argon2id setting fails the same way.
    for (const change of [
      { schema: header.schema + 1 },
      { kdf: { ...header.kdf, iterations: header.kdf.iterations + 1 } },
    ]) {
      const changed = Buffer.from(
        JSON.stringify({
          ...JSON.parse(file.subarray(12, start).toString()),
          ...change,
        }),
      )
      const size = Buffer.alloc(4)
      size.writeUInt32BE(changed.length)
      const edited = readBackup(
        Buffer.concat([
          Buffer.from('LLBACKUP'),
          size,
          changed,
          file.subarray(start),
        ]),
      )
      expect(edited).not.toBeNull()
      expect(await dataKey(edited!)).toBeNull()
    }
  })
})
