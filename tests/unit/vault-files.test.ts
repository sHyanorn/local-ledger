// Files written by an earlier build must keep opening: a vault and a backup
// made with the test passphrase and fake data, checked as known answers.
import { cpSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { listAccounts } from '../../src/main/ledger/accounts'
import { pageTransactions } from '../../src/main/ledger/transactions'
import { readBackup } from '../../src/main/vault/backup'
import { deriveHere } from '../../src/main/vault/kdf'
import { Vault } from '../../src/main/vault/vault'
import { parseVaultFile } from '../../src/main/vault/vault-file'
import { PASSWORD } from '../support/vault'
import { tempDirs } from '../support/temp-dir'

const FIXTURES = join(__dirname, '../fixtures/vault-v1')
const base64 = (text: string) => Buffer.from(text, 'base64')

const KDF = {
  memoryKiB: 19_456,
  iterations: 2,
  parallelism: 1,
  salt: base64('EJIJy+S7drYnFCxBIDZhMQ=='),
}
const VAULT_TEXT = readFileSync(join(FIXTURES, 'vault/vault.json'), 'utf8')
const VAULT_JSON = JSON.parse(VAULT_TEXT) as Record<string, unknown>
const BACKUP = readFileSync(join(FIXTURES, 'fake.llbackup'))
const BACKUP_HEADER = JSON.parse(
  BACKUP.subarray(12, 12 + BACKUP.readUInt32BE(8)).toString('utf8'),
) as Record<string, unknown>

/** A copy of a JSON value with one field, at a path, replaced or removed. */
function edited(
  value: Record<string, unknown>,
  path: string[],
  replacement: unknown,
): Record<string, unknown> {
  const copy = structuredClone(value)
  const key = path.at(-1)!
  let parent: Record<string, unknown> = copy
  for (const step of path.slice(0, -1))
    parent = parent[step] as Record<string, unknown>
  if (replacement === undefined) delete parent[key]
  else parent[key] = replacement
  return copy
}

/** The backup file with another header in front of the same database. */
function withHeader(header: Record<string, unknown>): Buffer {
  const json = Buffer.from(JSON.stringify(header))
  const length = Buffer.alloc(4)
  length.writeUInt32BE(json.length)
  const database = BACKUP.subarray(12 + BACKUP.readUInt32BE(8))
  return Buffer.concat([Buffer.from('LLBACKUP'), length, json, database])
}

/** Changes either file format refuses. */
const VARIANTS: [string, string[], unknown][] = [
  ['an unknown version', ['version'], 2],
  ['no version', ['version'], undefined],
  ['another algorithm', ['kdf', 'algorithm'], 'argon2i'],
  ['memory below the floor', ['kdf', 'memoryKiB'], 19_455],
  ['memory above the ceiling', ['kdf', 'memoryKiB'], 1_048_577],
  ['memory as text', ['kdf', 'memoryKiB'], '19456'],
  ['no passes', ['kdf', 'iterations'], 0],
  ['too many passes', ['kdf', 'iterations'], 11],
  ['fractional passes', ['kdf', 'iterations'], 2.5],
  ['too many lanes', ['kdf', 'parallelism'], 17],
  [
    'a short salt',
    ['kdf', 'salt'],
    base64('EJIJy+S7drYnFCxB').toString('base64'),
  ],
  ['a salt that is not base64', ['kdf', 'salt'], 'not base64!'],
  ['an extra KDF field', ['kdf', 'extra'], 1],
  ['a short nonce', ['key', 'nonce'], 'tkdBgxDCE9HH'],
  ['a nonce as a number', ['key', 'nonce'], 12],
  ['no sealed key', ['key', 'sealed'], undefined],
  ['an extra field', ['extra'], true],
]

const newDir = tempDirs('ledger-files-')
let root: string
beforeEach(() => {
  root = newDir()
})

describe('a vault from version 1', () => {
  it('parses to the recorded settings and sealed key', () => {
    expect(parseVaultFile(VAULT_TEXT)).toEqual({
      generation: 1,
      kdf: KDF,
      key: {
        nonce: base64('tkdBgxDCE9HHyPb4'),
        sealed: base64(
          '5AuqARdi24aV2d1mC9pfOWWW9FKJdskOCv+yMr+pRtdgU8RyaB/CD174qwkrXtcm',
        ),
      },
    })
  })

  it('opens with the passphrase and holds its fake data', async () => {
    cpSync(join(FIXTURES, 'vault'), join(root, 'vault'), { recursive: true })
    const vault = new Vault(root, { derive: deriveHere })
    expect(vault.state).toBe('locked')
    expect(await vault.unlock(`${PASSWORD} but wrong`)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(await vault.unlock(PASSWORD)).toEqual({ ok: true })
    const db = vault.database()
    expect(listAccounts(db)).toMatchObject([
      { name: 'Fake Everyday', currency: 'AUD', balanceCents: 8_095 },
    ])
    expect(pageTransactions(db, { filter: {}, limit: 10 }).rows).toMatchObject([
      { date: '2026-10-31', amountCents: -4_250, description: 'FAKE MART' },
    ])
    vault.lock()
  })

  it.each([...VARIANTS, ['generation 0', ['generation'], 0]] as const)(
    'is refused with %s',
    (_, path, replacement) => {
      const text = JSON.stringify(edited(VAULT_JSON, [...path], replacement))
      expect(parseVaultFile(text)).toBeNull()
    },
  )
})

describe('a backup from version 1', () => {
  it('reads to the recorded header', () => {
    const read = readBackup(BACKUP)
    expect(read?.header).toEqual({
      schema: 7,
      size: 122_880,
      sha256: base64('HjrTjSB9TtD3oOZHPXlP51HGNE9gz2+8eVvbDfCHAao='),
      kdf: KDF,
      key: {
        nonce: base64('Gayatl05u46qzLog'),
        sealed: base64(
          'hoCkiMvgm1Qww0tDw2KY7+wkZCqE+IcZYzbe8prAfaOKEIeMC4uu3yMFeLciV/bR',
        ),
      },
    })
    expect(read?.database.length).toBe(122_880)
  })

  it('checks and restores with the passphrase', async () => {
    const vault = new Vault(root, { derive: deriveHere })
    const checked = await vault.checkBackup(BACKUP, PASSWORD)
    if (!checked.ok) throw new Error(checked.reason)
    expect(checked.staged.summary).toEqual({
      accounts: 1,
      transactions: 1,
      lastDate: '2026-10-31',
    })
    expect(await vault.restore(checked.staged, null)).toEqual({ ok: true })
    expect(listAccounts(vault.database())).toMatchObject([
      { name: 'Fake Everyday' },
    ])
    vault.lock()
  })

  it.each([
    ...VARIANTS,
    ['another format', ['format'], 'other backup'],
  ] as const)('is refused with %s', (_, path, replacement) => {
    const header = edited(BACKUP_HEADER, [...path], replacement)
    expect(readBackup(withHeader(header))).toBeNull()
  })

  it('reads again with its own header rebuilt', () => {
    expect(readBackup(withHeader(BACKUP_HEADER))).not.toBeNull()
  })
})
