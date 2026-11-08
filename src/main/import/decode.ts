// Bank exports name no encoding. A byte order mark decides when there is one;
// otherwise the text is UTF-8 if it decodes as UTF-8 without error, and
// Windows-1252 if not, since that decodes any byte sequence.

export const ENCODINGS = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'windows-1252',
] as const
export type Encoding = (typeof ENCODINGS)[number]

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

/** Text from the bytes, in the given encoding or the one detected. */
export function decode(
  bytes: Uint8Array,
  encoding?: Encoding,
): { text: string; encoding: Encoding } {
  const chosen = encoding ?? bomOf(bytes)
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
