// Text from outside the app, such as a CSV cell or a file name, as the
// ledger stores and shows it.

/**
 * Bidirectional controls, which can reorder how text around them reads,
 * and zero-width spaces, word joiners and byte order marks, which hide
 * differences between texts. Zero-width joiners and non-joiners stay:
 * scripts and emoji need them.
 */
const INVISIBLE =
  /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g

/**
 * Text as stored: bidirectional controls and zero-width spaces are dropped,
 * control characters become spaces, runs of space become one, and the
 * result is in composed form like every name in the ledger.
 */
export function cleanText(text: string): string {
  return text
    .replace(INVISIBLE, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .normalize('NFC')
}
