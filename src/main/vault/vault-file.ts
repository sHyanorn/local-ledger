// vault.json: the plaintext record of how to derive the key from the master
// password, and the data key sealed under it. The database is encrypted with
// the data key; the file names which database generation is current.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { KDF_BOUNDS, SALT_BYTES } from './kdf'
import type { KdfParams } from './kdf'
import type { Sealed } from './envelope'

export const VAULT_FILE = 'vault.json'

export interface VaultFile {
  generation: number
  kdf: KdfParams & { salt: Buffer }
  key: Sealed
}

/** Base64 text of exactly `length` bytes, read as a Buffer. */
export const base64Bytes = (length: number) =>
  z
    .base64()
    .transform((text) => Buffer.from(text, 'base64'))
    .refine((buffer) => buffer.length === length)

const bounded = ({ min, max }: { min: number; max: number }) =>
  z.int().min(min).max(max)

/** Argon2id settings and salt, as vault.json and backup headers store them. */
export const kdfSchema = z
  .strictObject({
    algorithm: z.literal('argon2id'),
    memoryKiB: bounded(KDF_BOUNDS.memoryKiB),
    iterations: bounded(KDF_BOUNDS.iterations),
    parallelism: bounded(KDF_BOUNDS.parallelism),
    salt: base64Bytes(SALT_BYTES),
  })
  .transform(({ memoryKiB, iterations, parallelism, salt }) => ({
    memoryKiB,
    iterations,
    parallelism,
    salt,
  }))

/** A data key sealed with AES-256-GCM: the nonce, then the key and its tag. */
export const sealedSchema = z.strictObject({
  nonce: base64Bytes(12),
  sealed: base64Bytes(48),
})

const schema = z.strictObject({
  version: z.literal(1),
  generation: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
  kdf: kdfSchema,
  key: sealedSchema,
  check: base64Bytes(32).optional(),
})

/**
 * Authenticated with the sealed key, so changing the generation or the KDF
 * settings in the file makes it fail to open.
 */
export function associatedData({
  generation,
  kdf,
}: VaultFile | Omit<VaultFile, 'key'>): Buffer {
  return Buffer.from(
    [
      'local-ledger vault v1',
      generation,
      'argon2id',
      kdf.memoryKiB,
      kdf.iterations,
      kdf.parallelism,
      kdf.salt.toString('base64'),
    ].join('\n'),
  )
}

/**
 * SHA-256 over everything else the file holds. It tells a damaged file from
 * a wrong password; it is not keyed, so it proves nothing about who wrote
 * the file. Files written before it existed have none.
 */
function checksum(file: VaultFile): Buffer {
  return createHash('sha256')
    .update(associatedData(file))
    .update(file.key.nonce)
    .update(file.key.sealed)
    .digest()
}

function read(text: string): { file: VaultFile; checked: boolean } | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) return null
  const { generation, kdf, key, check } = parsed.data
  const file = { generation, kdf, key }
  if (check && !check.equals(checksum(file))) return null
  return { file, checked: check !== undefined }
}

/**
 * The parsed file, or null when it is not a valid vault file or does not
 * match its checksum.
 */
export function parseVaultFile(text: string): VaultFile | null {
  return read(text)?.file ?? null
}

/** True for a valid file written before the checksum existed. */
export function lacksChecksum(text: string): boolean {
  return read(text)?.checked === false
}

export function serializeVaultFile({
  generation,
  kdf,
  key,
}: VaultFile): string {
  return `${JSON.stringify(
    {
      version: 1,
      generation,
      kdf: {
        algorithm: 'argon2id',
        memoryKiB: kdf.memoryKiB,
        iterations: kdf.iterations,
        parallelism: kdf.parallelism,
        salt: kdf.salt.toString('base64'),
      },
      key: {
        nonce: key.nonce.toString('base64'),
        sealed: key.sealed.toString('base64'),
      },
      check: checksum({ generation, kdf, key }).toString('base64'),
    },
    null,
    2,
  )}\n`
}
