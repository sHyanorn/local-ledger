// The checksum in vault.json: a file that does not match it is a damaged
// vault, not a wrong password, and files from before it existed gain one.
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveHere } from '../../src/main/vault/kdf'
import { Vault } from '../../src/main/vault/vault'
import {
  lacksChecksum,
  parseVaultFile,
  serializeVaultFile,
} from '../../src/main/vault/vault-file'
import { FAST, PASSWORD } from '../support/vault'

const FIXTURE = join(__dirname, '../fixtures/vault-v1/vault')

let root: string
let path: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ledger-checksum-'))
  path = join(root, 'vault', 'vault.json')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const open = (checkpoint?: (step: string) => void) =>
  new Vault(root, { derive: deriveHere, kdf: FAST, checkpoint })

/** vault.json with one bit of a base64 field flipped. */
function flipped(text: string, field: string[]): string {
  const json = JSON.parse(text) as Record<string, unknown>
  let parent = json
  for (const step of field.slice(0, -1))
    parent = parent[step] as Record<string, unknown>
  const key = field.at(-1)!
  const bytes = Buffer.from(parent[key] as string, 'base64')
  bytes[5]! ^= 1
  parent[key] = bytes.toString('base64')
  return `${JSON.stringify(json, null, 2)}\n`
}

describe('a vault file with a checksum', () => {
  it('is what every new vault has', async () => {
    const vault = open()
    await vault.create(PASSWORD)
    vault.lock()
    const text = readFileSync(path, 'utf8')
    expect(JSON.parse(text)).toHaveProperty('check')
    expect(lacksChecksum(text)).toBe(false)
    expect(serializeVaultFile(parseVaultFile(text)!)).toBe(text)
  })

  it.each([
    ['the sealed key', ['key', 'sealed']],
    ['the nonce', ['key', 'nonce']],
    ['the salt', ['kdf', 'salt']],
    ['the checksum', ['check']],
  ])(
    'is a damaged vault, left as it is, with one bit of %s flipped',
    async (_, field) => {
      const vault = open()
      await vault.create(PASSWORD)
      vault.lock()
      const damaged = flipped(readFileSync(path, 'utf8'), field)
      writeFileSync(path, damaged)
      expect(parseVaultFile(damaged)).toBeNull()
      expect(vault.state).toBe('damaged')
      expect(await vault.unlock(PASSWORD)).toEqual({
        ok: false,
        reason: 'damaged',
      })
      expect(readFileSync(path, 'utf8')).toBe(damaged)
    },
  )

  it('is a damaged vault with another generation or KDF setting', async () => {
    const vault = open()
    await vault.create(PASSWORD)
    vault.lock()
    const json = JSON.parse(readFileSync(path, 'utf8'))
    for (const edit of [
      { ...json, generation: 2 },
      { ...json, kdf: { ...json.kdf, iterations: 3 } },
    ])
      expect(parseVaultFile(JSON.stringify(edit))).toBeNull()
  })
})

describe('a vault file from before the checksum', () => {
  beforeEach(() => {
    cpSync(FIXTURE, join(root, 'vault'), { recursive: true })
  })

  it('gains one at the first unlock, and opens as before', async () => {
    const before = readFileSync(path, 'utf8')
    expect(lacksChecksum(before)).toBe(true)
    const vault = open()
    expect(await vault.unlock(`${PASSWORD} but wrong`)).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(readFileSync(path, 'utf8')).toBe(before)

    expect(await vault.unlock(PASSWORD)).toEqual({ ok: true })
    vault.lock()
    const after = readFileSync(path, 'utf8')
    expect(lacksChecksum(after)).toBe(false)
    expect(parseVaultFile(after)).toEqual(parseVaultFile(before))
    expect(existsSync(`${path}.tmp`)).toBe(false)

    expect(await vault.unlock(PASSWORD)).toEqual({ ok: true })
    vault.lock()
    expect(readFileSync(path, 'utf8')).toBe(after)
  })

  it('opens whether or not a crash let the new file replace the old one', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const before = readFileSync(path, 'utf8')
    const crashing = open((step) => {
      if (step === 'temporary file written') throw new Error('crash')
    })
    // The unlock itself stands.
    expect(await crashing.unlock(PASSWORD)).toEqual({ ok: true })
    crashing.lock()
    expect(log).toHaveBeenCalledWith('adding the vault checksum failed: Error')
    log.mockRestore()
    expect(readFileSync(path, 'utf8')).toBe(before)

    // The old file is in place: it opens, and the next unlock finishes.
    const temporary = `${path}.tmp`
    const written = readFileSync(temporary, 'utf8')
    expect(lacksChecksum(written)).toBe(false)
    const kept = join(root, 'written.json')
    copyFileSync(temporary, kept)
    const old = open()
    expect(await old.unlock(PASSWORD)).toEqual({ ok: true })
    old.lock()
    expect(lacksChecksum(readFileSync(path, 'utf8'))).toBe(false)
    expect(existsSync(temporary)).toBe(false)

    // Had the rename happened, the new file opens too.
    copyFileSync(kept, path)
    const renamed = open()
    expect(await renamed.unlock(PASSWORD)).toEqual({ ok: true })
    renamed.lock()
  })
})
