import { argon2id } from 'hash-wasm'

export interface KdfParams {
  memoryKiB: number
  iterations: number
  parallelism: number
}

/** RFC 9106, second recommended option. */
export const DEFAULT_KDF: KdfParams = {
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 4,
}

/**
 * What a vault file may ask for. The floor is the OWASP minimum (19 MiB);
 * the ceilings keep a tampered file from exhausting memory or time.
 */
export const KDF_BOUNDS = {
  memoryKiB: { min: 19_456, max: 1_048_576 },
  iterations: { min: 1, max: 10 },
  parallelism: { min: 1, max: 16 },
} as const

export const KEY_BYTES = 32
export const SALT_BYTES = 16

/**
 * UTF-8 bytes of the NFKC form, so the same password typed on any keyboard
 * gives the same key. The array owns its buffer, so it can be transferred to
 * a worker and wiped there.
 */
export function encodePassword(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize('NFKC'))
}

/** Argon2id on the calling thread; wipes the password bytes. */
export async function argon2(
  password: Uint8Array,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  try {
    return await argon2id({
      password,
      salt,
      memorySize: params.memoryKiB,
      iterations: params.iterations,
      parallelism: params.parallelism,
      hashLength: KEY_BYTES,
      outputType: 'binary',
    })
  } finally {
    password.fill(0)
  }
}

/** Derives a key from encoded password bytes, which it consumes. */
export type Derive = (
  password: Uint8Array,
  salt: Uint8Array,
  params: KdfParams,
) => Promise<Buffer>

/** In-process derivation, for tests; the app derives in a worker. */
export const deriveHere: Derive = async (password, salt, params) => {
  const key = await argon2(password, salt, params)
  return Buffer.from(key.buffer, key.byteOffset, key.byteLength)
}
