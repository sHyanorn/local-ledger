// Bank exports name no encoding. A byte order mark decides when there is one;
// then UTF-16 when every other byte is zero, as ASCII text in it has; then
// UTF-8 if the bytes decode as UTF-8 without error, and Windows-1252 if not,
// since that decodes any byte sequence.

import type { Encoding } from '../../shared/imports'

const BOMS: readonly [Encoding, readonly number[]][] = [
  ['utf-8', [0xef, 0xbb, 0xbf]],
  ['utf-16le', [0xff, 0xfe]],
  ['utf-16be', [0xfe, 0xff]],
]

function bomOf(bytes: Uint8Array): Encoding | null {
  for (const [encoding, bom] of BOMS) {
    if (bom.every((byte, index) => bytes[index] === byte)) return encoding
  }
  return null
}

/**
 * UTF-16 without a byte order mark: ASCII text in it has a zero byte in
 * every other place, which text in any other encoding here does not.
 */
function utf16Of(bytes: Uint8Array): Encoding | null {
  const sample = bytes.subarray(0, 4096)
  let even = 0
  let odd = 0
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      if (i % 2 === 0) even++
      else odd++
    }
  }
  const half = sample.length / 2
  if (half < 2) return null
  // A few zeros on the other side are characters such as U+0100 or U+3000.
  if (odd > half * 0.3 && even <= odd * 0.02) return 'utf-16le'
  if (even > half * 0.3 && odd <= even * 0.02) return 'utf-16be'
  return null
}

/** Text from the bytes, in the given encoding or the one detected. */
export function decode(
  bytes: Uint8Array,
  encoding?: Encoding,
): { text: string; encoding: Encoding } {
  const chosen = encoding ?? bomOf(bytes) ?? utf16Of(bytes)
  if (chosen) {
    // TextDecoder drops a byte order mark that matches the encoding.
    return { text: new TextDecoder(chosen).decode(bytes), encoding: chosen }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text, encoding: 'utf-8' }
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      encoding: 'windows-1252',
    }
  }
}
