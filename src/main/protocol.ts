import { readFile } from 'node:fs/promises'
import { protocol } from 'electron'
import {
  APP_SCHEME,
  CONTENT_SECURITY_POLICY,
  contentType,
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

/** Serves the renderer build from root, read-only, with the CSP on every response. */
export function serveAppScheme(root: string): void {
  const empty = (status: number) =>
    new Response(null, { status, headers: HEADERS })
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET') return empty(405)
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
