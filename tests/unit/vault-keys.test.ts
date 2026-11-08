import { createDecipheriv } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { open, seal } from '../../src/main/vault/envelope'
import {
  argon2,
  DEFAULT_KDF,
  deriveHere,
  encodePassword,
} from '../../src/main/vault/kdf'
import type { KdfParams } from '../../src/main/vault/kdf'
import { createKey, openKey } from '../../src/main/vault/keys'
import {
  associatedData,
  parseVaultFile,
  serializeVaultFile,
} from '../../src/main/vault/vault-file'
import type { VaultFile } from '../../src/main/vault/vault-file'

const FAST: KdfParams = { memoryKiB: 19_456, iterations: 2, parallelism: 1 }
const PASSWORD = 'correct horse battery staple'
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const derive = (password: string, saltByte: number, params: KdfParams) =>
  deriveHere(
    encodePassword(password),
    new Uint8Array(16).fill(saltByte),
    params,
  )

describe('key derivation', () => {
  // Computed with hash-wasm 4.13.0 and checked against the reference C
  // implementation (node-argon2 0.45.2). A change here locks out every vault.
  it.each([
    [
      PASSWORD,
      0x07,
      DEFAULT_KDF,
      '0b167e20ffb8a31f75eb3e471872ba0a5747d56ec494db5becb07108141bff24',
    ],
    [
      PASSWORD,
      0x07,
      FAST,
      '799f12b9e17710824482d829835acb69f5a9355bf774c4f07342823b11b90928',
    ],
    [
      'pässwörd with ümlauts and 🔒',
      0x2a,
      FAST,
      'a68a61bbb57525dbe6f4fd4fea8f64ed4e2c6cb0365ff4d06f340c8f8e626bdd',
    ],
    [
      `${String.fromCodePoint(0xfb01)}nance ledger passphrase`,
      0x01,
      FAST,
      'b8e450d4d92bdcdea18b2666806e0e9e507d674a8eea23572ce47635e959432d',
    ],
  ])(
    'matches the pinned Argon2id vector for %j',
    async (password, salt, params, expected) => {
      expect(hex(await derive(password, salt, params))).toBe(expected)
    },
  )

  it('gives the same key for composed and decomposed input', async () => {
    const composed = await derive('café au lait every morning', 3, FAST)
    const decomposed = await derive('café au lait every morning', 3, FAST)
    expect(hex(decomposed)).toBe(hex(composed))
  })

  it('wipes the password bytes', async () => {
    const password = encodePassword(PASSWORD)
    await argon2(password, new Uint8Array(16), FAST)
    expect(password.every((byte) => byte === 0)).toBe(true)
  })

  it('encodes into a buffer of its own, so it can be transferred', () => {
    const bytes = encodePassword(PASSWORD)
    expect(bytes.byteOffset).toBe(0)
    expect(bytes.buffer.byteLength).toBe(bytes.length)
  })
})

describe('envelope', () => {
  const key = Buffer.alloc(32, 1)
  const aad = Buffer.from('header')
  const secret = Buffer.alloc(32, 9)

  it('opens what it sealed', () => {
    expect(open(key, seal(key, secret, aad), aad)).toEqual(secret)
  })

  it('refuses a wrong key, altered bytes or other associated data', () => {
    const sealed = seal(key, secret, aad)
    const flip = (buffer: Buffer, index: number) => {
      const copy = Buffer.from(buffer)
      copy[index] = (copy[index] ?? 0) ^ 1
      return copy
    }
    expect(open(Buffer.alloc(32, 2), sealed, aad)).toBeNull()
    expect(open(key, sealed, Buffer.from('other'))).toBeNull()
    expect(
      open(key, { ...sealed, nonce: flip(sealed.nonce, 0) }, aad),
    ).toBeNull()
    expect(
      open(key, { ...sealed, sealed: flip(sealed.sealed, 0) }, aad),
    ).toBeNull()
    expect(
      open(key, { ...sealed, sealed: flip(sealed.sealed, 47) }, aad),
    ).toBeNull()
    expect(
      open(key, { ...sealed, sealed: sealed.sealed.subarray(0, 16) }, aad),
    ).toBeNull()
  })

  it('wipes what it decrypted when the tag does not verify', () => {
    // GCM decrypts before it checks the tag, so with the right key and an
    // altered tag the body holds the secret.
    const sealed = seal(key, secret, aad)
    const tag = sealed.sealed.length - 1
    const altered = Buffer.from(sealed.sealed)
    altered[tag] = (altered[tag] ?? 0) ^ 1
    const decipher = Object.getPrototypeOf(
      createDecipheriv('aes-256-gcm', key, sealed.nonce),
    ) as { update: (data: Buffer) => Buffer }
    const original = decipher.update
    const bodies: Buffer[] = []
    const spy = vi.spyOn(decipher, 'update').mockImplementation(function (
      this: unknown,
      data: Buffer,
    ) {
      const body = original.call(this, data)
      bodies.push(body)
      return body
    })
    try {
      expect(open(key, { ...sealed, sealed: altered }, aad)).toBeNull()
    } finally {
      spy.mockRestore()
    }
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toEqual(Buffer.alloc(secret.length))
  })
})

describe('vault file', () => {
  const file: VaultFile = {
    generation: 3,
    kdf: { ...DEFAULT_KDF, salt: Buffer.alloc(16, 5) },
    key: { nonce: Buffer.alloc(12, 6), sealed: Buffer.alloc(48, 7) },
  }
  const json = () => JSON.parse(serializeVaultFile(file))
  const edit = (change: (value: Record<string, any>) => void) => {
    const value = json()
    change(value)
    return parseVaultFile(JSON.stringify(value))
  }

  it('round-trips', () => {
    expect(parseVaultFile(serializeVaultFile(file))).toEqual(file)
  })

  it.each([
    ['not JSON', () => parseVaultFile('{')],
    ['another version', () => edit((v) => (v.version = 2))],
    ['an unknown field', () => edit((v) => (v.extra = 1))],
    ['generation 0', () => edit((v) => (v.generation = 0))],
    ['another algorithm', () => edit((v) => (v.kdf.algorithm = 'scrypt'))],
    ['memory below the floor', () => edit((v) => (v.kdf.memoryKiB = 19_455))],
    [
      'memory above the ceiling',
      () => edit((v) => (v.kdf.memoryKiB = 1_048_577)),
    ],
    ['no iterations', () => edit((v) => (v.kdf.iterations = 0))],
    ['too many iterations', () => edit((v) => (v.kdf.iterations = 11))],
    ['too many lanes', () => edit((v) => (v.kdf.parallelism = 17))],
    ['a fractional setting', () => edit((v) => (v.kdf.iterations = 2.5))],
    [
      'a short salt',
      () => edit((v) => (v.kdf.salt = Buffer.alloc(8).toString('base64'))),
    ],
    [
      'a long nonce',
      () => edit((v) => (v.key.nonce = Buffer.alloc(16).toString('base64'))),
    ],
    [
      'a short sealed key',
      () => edit((v) => (v.key.sealed = Buffer.alloc(32).toString('base64'))),
    ],
    ['invalid base64', () => edit((v) => (v.key.sealed = '%%%'))],
  ])('rejects %s', (_label, parse) => {
    expect(parse()).toBeNull()
  })

  it('binds the generation and KDF settings to the sealed key', () => {
    const base = associatedData(file).toString()
    expect(associatedData({ ...file, generation: 4 }).toString()).not.toBe(base)
    expect(
      associatedData({
        ...file,
        kdf: { ...file.kdf, iterations: 4 },
      }).toString(),
    ).not.toBe(base)
  })
})

describe('data key', () => {
  it('opens with the password it was sealed under', async () => {
    const { file, dataKey } = await createKey(PASSWORD, 1, deriveHere, FAST)
    expect(dataKey).toHaveLength(32)
    expect(await openKey(file, PASSWORD, deriveHere)).toEqual(dataKey)
  })

  it('does not open with another password', async () => {
    const { file } = await createKey(PASSWORD, 1, deriveHere, FAST)
    expect(await openKey(file, `${PASSWORD}!`, deriveHere)).toBeNull()
  })

  it('does not open when the file is altered', async () => {
    const { file } = await createKey(PASSWORD, 1, deriveHere, FAST)
    expect(
      await openKey({ ...file, generation: 2 }, PASSWORD, deriveHere),
    ).toBeNull()
    const salt = Buffer.from(file.kdf.salt)
    salt[0] = (salt[0] ?? 0) ^ 1
    expect(
      await openKey(
        { ...file, kdf: { ...file.kdf, salt } },
        PASSWORD,
        deriveHere,
      ),
    ).toBeNull()
  })

  it('never writes the data key in clear', async () => {
    const { file, dataKey } = await createKey(PASSWORD, 1, deriveHere, FAST)
    const text = serializeVaultFile(file)
    expect(text).not.toContain(dataKey.toString('hex'))
    expect(text).not.toContain(dataKey.toString('base64'))
  })

  it('draws a new salt and data key each time', async () => {
    const a = await createKey(PASSWORD, 1, deriveHere, FAST)
    const b = await createKey(PASSWORD, 1, deriveHere, FAST)
    expect(a.file.kdf.salt).not.toEqual(b.file.kdf.salt)
    expect(a.dataKey).not.toEqual(b.dataKey)
  })
})
