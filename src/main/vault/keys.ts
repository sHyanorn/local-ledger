// The data key and its envelope. The master password only ever derives the
// key that seals the data key; the database is encrypted with the data key.
import { randomFillSync } from 'node:crypto'
import { open, seal } from './envelope'
import { DEFAULT_KDF, encodePassword, KEY_BYTES, SALT_BYTES } from './kdf'
import type { Derive, KdfParams } from './kdf'
import { associatedData } from './vault-file'
import type { VaultFile } from './vault-file'

export interface NewKey {
  file: VaultFile
  /** The caller zeroes it once the database holds it. */
  dataKey: Buffer
}

/** A fresh random data key, sealed under the password, for a generation. */
export async function createKey(
  password: string,
  generation: number,
  derive: Derive,
  params: KdfParams = DEFAULT_KDF,
): Promise<NewKey> {
  const dataKey = randomFillSync(Buffer.alloc(KEY_BYTES))
  try {
    const file = await sealDataKey(
      password,
      dataKey,
      generation,
      derive,
      params,
    )
    return { file, dataKey }
  } catch (error) {
    dataKey.fill(0)
    throw error
  }
}

/** The data key, or null when the password is wrong or the file was altered. */
export async function openKey(
  file: VaultFile,
  password: string,
  derive: Derive,
): Promise<Buffer | null> {
  const sealingKey = await derive(
    encodePassword(password),
    file.kdf.salt,
    file.kdf,
  )
  try {
    return open(sealingKey, file.key, associatedData(file))
  } finally {
    sealingKey.fill(0)
  }
}

/** A given data key sealed under the password with a fresh salt, for a generation. */
export async function sealDataKey(
  password: string,
  dataKey: Uint8Array,
  generation: number,
  derive: Derive,
  params: KdfParams = DEFAULT_KDF,
): Promise<VaultFile> {
  const salt = randomFillSync(Buffer.alloc(SALT_BYTES))
  const header = { generation, kdf: { ...params, salt } }
  const sealingKey = await derive(encodePassword(password), salt, params)
  try {
    return { ...header, key: seal(sealingKey, dataKey, associatedData(header)) }
  } finally {
    sealingKey.fill(0)
  }
}
