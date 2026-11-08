import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { protocol } from 'electron'
import {
  APP_ORIGIN,
  APP_SCHEME,
  CONTENT_SECURITY_POLICY,
  PRINT_CONTENT_SECURITY_POLICY,
  contentType,
  isAppUrl,
  resolveAppAsset,
} from './security'

const HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
}

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true } },
  ])
}

interface PrintFile {
  type: string
  body: string
}

/** Pages to print, by a one-time path; they exist only in memory. */
const printing = new Map<string, Map<string, PrintFile>>()

/**
 * Serves files at a random path under /print/ until released, for a hidden
 * window to print. Returns the URL of the named page.
 */
export function servePrint(
  files: Record<string, PrintFile>,
  page: string,
): { url: string; release: () => void } {
  const token = randomUUID()
  printing.set(token, new Map(Object.entries(files)))
  return {
    url: `${APP_ORIGIN}/print/${token}/${page}`,
    release: () => printing.delete(token),
  }
}

function printResponse(url: string): Response | null {
  if (!isAppUrl(url)) return null
  const match = /^\/print\/([^/]+)\/([^/]+)$/.exec(new URL(url).pathname)
  if (!match) return null
  const file = printing.get(match[1]!)?.get(match[2]!)
  const headers = {
    'Content-Security-Policy': PRINT_CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  }
  return file
    ? new Response(file.body, {
        headers: { ...headers, 'Content-Type': file.type },
      })
    : new Response(null, { status: 404, headers })
}

/** Serves the renderer build from root, read-only, with the CSP on every response. */
export function serveAppScheme(root: string): void {
  const empty = (status: number) =>
    new Response(null, { status, headers: HEADERS })
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET') return empty(405)
    const printed = printResponse(request.url)
    if (printed) return printed
    const file = resolveAppAsset(root, request.url)
    if (file === null) return empty(404)
    let body: Buffer
    try {
      body = await readFile(file)
    } catch {
      return empty(404)
    }
    return new Response(new Uint8Array(body), {
      headers: { ...HEADERS, 'Content-Type': contentType(file) },
    })
  })
}
