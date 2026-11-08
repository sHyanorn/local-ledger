/**
 * Text as rules and duplicate checks compare it: composed, lower case,
 * single spaces. "FAKE  Café" and "fake café" have the same key.
 */
export const matchKey = (text: string) =>
  text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
