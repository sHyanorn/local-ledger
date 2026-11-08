// A backup file: the encrypted database exactly as the vault holds it, with
// the data key sealed the way vault.json seals it. The sealing also covers
// the database's length, SHA-256 and schema version, so a header and a
// database from different backups, or a cut or altered one, do not open.
//
//   "LLBACKUP" | header length (4 bytes, big-endian) | header JSON | database
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { open, seal, type Sealed } from './envelope'
import type { KdfParams } from './kdf'
import { base64Bytes, kdfSchema, sealedSchema } from './vault-file'

const MAGIC = Buffer.from('LLBACKUP')
const HEADER_MAX = 4096

export interface BackupHeader {
  /** The database's schema version (PRAGMA user_version). */
  schema: number
  size: number
  sha256: Buffer
  kdf: KdfParams & { salt: Buffer }
  key: Sealed
}

const schema = z.strictObject({
  format: z.literal('local-ledger backup'),
  version: z.literal(1),
  schema: z.int().min(1).max(10_000),
  size: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
  sha256: base64Bytes(32),
  kdf: kdfSchema,
  key: sealedSchema,
})

function associatedData(header: Omit<BackupHeader, 'key'>): Buffer {
  const { kdf } = header
  return Buffer.from(
    [
      'local-ledger backup v1',
      header.schema,
      header.size,
      header.sha256.toString('base64'),
      'argon2id',
      kdf.memoryKiB,
      kdf.iterations,
      kdf.parallelism,
      kdf.salt.toString('base64'),
    ].join('\n'),
  )
}

/**
 * The backup file for a database, its data key sealed under `sealingKey`,
 * which `kdf` derives from the password.
 */
export function writeBackup(
  database: Buffer,
  schemaVersion: number,
  dataKey: Uint8Array,
  sealingKey: Uint8Array,
  kdf: KdfParams & { salt: Buffer },
): Buffer {
  const unsealed = {
    schema: schemaVersion,
    size: database.length,
    sha256: createHash('sha256').update(database).digest(),
    kdf,
  }
  const key = seal(sealingKey, dataKey, associatedData(unsealed))
  const header = Buffer.from(
    JSON.stringify({
      format: 'local-ledger backup',
      version: 1,
      schema: unsealed.schema,
      size: unsealed.size,
      sha256: unsealed.sha256.toString('base64'),
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
    }),
  )
  const length = Buffer.alloc(4)
  length.writeUInt32BE(header.length)
  return Buffer.concat([MAGIC, length, header, database])
}

export interface ReadBackup {
  header: BackupHeader
  database: Buffer
}

/**
 * The header and database of a backup file, or null when it is not one or
 * its database does not match the header. The key is not checked here.
 */
export function readBackup(file: Buffer): ReadBackup | null {
  if (file.length < MAGIC.length + 4) return null
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) return null
  const length = file.readUInt32BE(MAGIC.length)
  if (length > HEADER_MAX) return null
  const start = MAGIC.length + 4
  if (file.length < start + length) return null
  let json: unknown
  try {
    json = JSON.parse(file.subarray(start, start + length).toString('utf8'))
  } catch {
    return null
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) return null
  const { schema: schemaVersion, size, sha256, kdf, key } = parsed.data
  const database = file.subarray(start + length)
  if (database.length !== size) return null
  if (!createHash('sha256').update(database).digest().equals(sha256))
    return null
  return {
    header: { schema: schemaVersion, size, sha256, kdf, key },
    database,
  }
}

/** The data key, or null when the sealing key is wrong or the header was altered. */
export function openBackupKey(
  header: BackupHeader,
  sealingKey: Uint8Array,
): Buffer | null {
  return open(sealingKey, header.key, associatedData(header))
}
