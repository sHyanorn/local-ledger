// Reads a Chromium net log (written with --log-net-log=<file>) and lists the
// network URLs it requested. The app is local-first, so the list must be empty.
import { readFileSync } from 'node:fs'

/**
 * @param {string} file
 * @returns {string[]}
 */
export function networkRequests(file) {
  let text = readFileSync(file, 'utf8').trim()
  // A log cut short when the process exits lacks its closing brackets.
  if (!text.endsWith('}')) text = `${text.replace(/,$/, '')}]}`
  /** @type {{ events?: { params?: { url?: unknown } }[] }} */
  const log = JSON.parse(text)
  const urls = new Set()
  for (const event of log.events ?? []) {
    const url = event.params?.url
    if (typeof url === 'string' && /^(https?|wss?|ftp):/i.test(url)) {
      urls.add(url)
    }
  }
  return [...urls]
}
