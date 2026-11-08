// AES-256-GCM sealing of the data key under the key derived from the
// master password.
import { createCipheriv, createDecipheriv, randomFillSync } from 'node:crypto'

const NONCE_BYTES = 12
const TAG_BYTES = 16

export interface Sealed {
  nonce: Buffer
  sealed: Buffer
}

export function seal(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Sealed {
  const nonce = randomFillSync(Buffer.alloc(NONCE_BYTES))
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad)
  const sealed = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  return { nonce, sealed }
}

/** The plaintext, or null when the key is wrong or anything was altered. */
export function open(
  key: Uint8Array,
  { nonce, sealed }: Sealed,
  aad: Uint8Array,
): Buffer | null {
  if (nonce.length !== NONCE_BYTES || sealed.length <= TAG_BYTES) return null
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(aad)
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES))
  const body = decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES))
  try {
    decipher.final()
  } catch {
    body.fill(0)
    return null
  }
  return body
}
