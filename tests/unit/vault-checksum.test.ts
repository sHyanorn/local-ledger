// The checksum in vault.json: when a password does not unseal the key, a
// file that does not match it is a damaged vault, not a wrong password. A
// key that unseals is whole whatever the checksum says. Files from before
// it existed gain one.
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
  parseVaultFile,
  readVaultFile,
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
const check = (text: string) => readVaultFile(text)?.check
const WRONG = `${PASSWORD} but wrong`
const DAMAGED = { ok: false, reason: 'damaged' }
const WRONG_PASSWORD = { ok: false, reason: 'wrong-password' }

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
  /** A new vault, locked, and the text of its vault.json. */
  async function locked(): Promise<{ vault: Vault; text: string }> {
    const vault = open()
    await vault.create(PASSWORD)
    vault.lock()
    return { vault, text: readFileSync(path, 'utf8') }
  }

  it('is what every new vault has', async () => {
    const { text } = await locked()
    expect(JSON.parse(text)).toHaveProperty('check')
    expect(check(text)).toBe('matches')
    expect(serializeVaultFile(parseVaultFile(text)!)).toBe(text)
  })

  it('that matches calls a wrong password wrong and opens with the right one', async () => {
    const { vault, text } = await locked()
    expect(vault.state).toBe('locked')
    expect(await vault.unlock(WRONG)).toEqual(WRONG_PASSWORD)
    expect(await vault.unlock(PASSWORD)).toEqual({ ok: true })
    vault.lock()
    expect(readFileSync(path, 'utf8')).toBe(text)
  })

  it.each([
    ['the sealed key', ['key', 'sealed']],
    ['the nonce', ['key', 'nonce']],
    ['the salt', ['kdf', 'salt']],
  ])(
    'is a damaged vault, left as it is, with one bit of %s flipped',
    async (_, field) => {
      const { vault, text } = await locked()
      const damaged = flipped(text, field)
      writeFileSync(path, damaged)
      expect(check(damaged)).toBe('differs')
      // Nothing shows which part is wrong until a password is tried.
      expect(vault.state).toBe('locked')
      expect(await vault.unlock(PASSWORD)).toEqual(DAMAGED)
      expect(await vault.unlock(WRONG)).toEqual(DAMAGED)
      expect(vault.unlocked).toBe(false)
      expect(readFileSync(path, 'utf8')).toBe(damaged)
    },
  )

  it.each([
    ['one bit flipped', (text: string) => flipped(text, ['check'])],
    [
      'one character replaced by another',
      (text: string) => text.replace(/("check": ")./, '$1*'),
    ],
    ['cut short', (text: string) => text.replace(/("check": ").{9}/, '$1')],
  ])(
    'opens with the checksum alone damaged, %s, and gets it written again',
    async (_, damage) => {
      const { vault, text } = await locked()
      const damaged = damage(text)
      expect(damaged).not.toBe(text)
      writeFileSync(path, damaged)
      expect(check(damaged)).toBe('differs')
      expect(vault.state).toBe('locked')
      // The checksum cannot vouch for the file, so a wrong password is not
      // told from damage; the file stays as it is and the right one opens.
      expect(await vault.unlock(WRONG)).toEqual(DAMAGED)
      expect(readFileSync(path, 'utf8')).toBe(damaged)
      expect(vault.state).toBe('locked')
      expect(await vault.unlock(PASSWORD)).toEqual({ ok: true })
      vault.lock()
      expect(readFileSync(path, 'utf8')).toBe(text)
      expect(existsSync(`${path}.tmp`)).toBe(false)
    },
  )

  it('stays open when writing the checksum again fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { text } = await locked()
    const damaged = flipped(text, ['check'])
    writeFileSync(path, damaged)
    const failing = open((step) => {
      if (step === 'temporary file written') throw new Error('crash')
    })
    expect(await failing.unlock(PASSWORD)).toEqual({ ok: true })
    expect(failing.unlocked).toBe(true)
    failing.lock()
    expect(log).toHaveBeenCalledWith('writing the vault checksum failed: Error')
    log.mockRestore()
    expect(readFileSync(path, 'utf8')).toBe(damaged)
  })

  it('is a damaged vault with another generation or KDF setting', async () => {
    const { vault, text } = await locked()
    const json = JSON.parse(text)
    // The database the edited file names is there, so only unsealing tells.
    copyFileSync(
      join(root, 'vault', 'ledger-1.db'),
      join(root, 'vault', 'ledger-2.db'),
    )
    for (const edit of [
      { ...json, generation: 2 },
      { ...json, kdf: { ...json.kdf, iterations: json.kdf.iterations + 1 } },
    ]) {
      writeFileSync(path, JSON.stringify(edit))
      expect(check(JSON.stringify(edit))).toBe('differs')
      expect(vault.state).toBe('locked')
      expect(await vault.unlock(PASSWORD)).toEqual(DAMAGED)
    }
  })

  it('damaged while the vault is open is not taken for a wrong password', async () => {
    const vault = open()
    await vault.create(PASSWORD)
    const text = readFileSync(path, 'utf8')
    writeFileSync(path, flipped(text, ['kdf', 'salt']))
    expect(await vault.changePassword(PASSWORD, 'another fake one')).toEqual(
      DAMAGED,
    )
    expect(await vault.backup(PASSWORD)).toEqual(DAMAGED)
    expect(vault.unlocked).toBe(true)

    writeFileSync(path, text)
    expect(await vault.changePassword(WRONG, 'another fake one')).toEqual(
      WRONG_PASSWORD,
    )
    expect(await vault.backup(WRONG)).toEqual(WRONG_PASSWORD)
    vault.lock()
  })
})

describe('a vault file from before the checksum', () => {
  beforeEach(() => {
    cpSync(FIXTURE, join(root, 'vault'), { recursive: true })
  })

  it('gains one at the first unlock, and opens as before', async () => {
    const before = readFileSync(path, 'utf8')
    expect(check(before)).toBe('none')
    const vault = open()
    expect(await vault.unlock(WRONG)).toEqual(WRONG_PASSWORD)
    expect(readFileSync(path, 'utf8')).toBe(before)

    expect(await vault.unlock(PASSWORD)).toEqual({ ok: true })
    vault.lock()
    const after = readFileSync(path, 'utf8')
    expect(check(after)).toBe('matches')
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
    expect(log).toHaveBeenCalledWith('writing the vault checksum failed: Error')
    log.mockRestore()
    expect(readFileSync(path, 'utf8')).toBe(before)

    // The old file is in place: it opens, and the next unlock finishes.
    const temporary = `${path}.tmp`
    const written = readFileSync(temporary, 'utf8')
    expect(check(written)).toBe('matches')
    const kept = join(root, 'written.json')
    copyFileSync(temporary, kept)
    const old = open()
    expect(await old.unlock(PASSWORD)).toEqual({ ok: true })
    old.lock()
    expect(check(readFileSync(path, 'utf8'))).toBe('matches')
    expect(existsSync(temporary)).toBe(false)

    // Had the rename happened, the new file opens too.
    copyFileSync(kept, path)
    const renamed = open()
    expect(await renamed.unlock(PASSWORD)).toEqual({ ok: true })
    renamed.lock()
  })
})
