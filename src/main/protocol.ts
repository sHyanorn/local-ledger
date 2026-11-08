import { readFile } from 'node:fs/promises'
import { protocol } from 'electron'
import {
  APP_SCHEME,
  CONTENT_SECURITY_POLICY,
  contentType,
  resolveAppAsset,
} from './security'

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true } },
  ])
}

/** Serves the renderer build from root, read-only, with the CSP on every response. */
export function serveAppScheme(root: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    const file = resolveAppAsset(root, request.url)
    if (file === null) return new Response(null, { status: 404 })
    let body: Buffer
    try {
      body = await readFile(file)
    } catch {
      return new Response(null, { status: 404 })
    }
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': contentType(file),
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
