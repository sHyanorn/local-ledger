// Security policy as plain functions, kept free of Electron runtime imports
// so unit tests can check it directly. hardening.ts and protocol.ts apply it.
import { extname, isAbsolute, join, posix, relative, sep } from 'node:path'
import type { WebPreferences } from 'electron'

export const APP_SCHEME = 'app'
export const APP_HOST = 'local-ledger'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ')

export function windowWebPreferences(
  preload: string,
  packaged: boolean,
): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    // Chromium downloads spellcheck dictionaries from a Google CDN.
    spellcheck: false,
    devTools: !packaged,
  }
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** True only for this app's own origin: no credentials, no port. */
export function isAppUrl(url: string): boolean {
  const parsed = parseUrl(url)
  return (
    parsed !== null &&
    parsed.protocol === `${APP_SCHEME}:` &&
    parsed.host === APP_HOST &&
    parsed.username === '' &&
    parsed.password === ''
  )
}

/**
 * Whether the session may make a request. Everything outside the app is
 * cancelled; the dev server is allowed only when one is in use.
 */
export function isAllowedRequest(url: string, devOrigin?: string): boolean {
  if (isAppUrl(url)) return true
  const parsed = parseUrl(url)
  if (parsed === null) return false
  if (['data:', 'blob:', 'devtools:'].includes(parsed.protocol)) return true
  if (devOrigin === undefined) return false
  const dev = new URL(devOrigin)
  const sameHost =
    parsed.host === dev.host && parsed.username === '' && parsed.password === ''
  return (
    sameHost && (parsed.protocol === dev.protocol || parsed.protocol === 'ws:')
  )
}

/** Whether an IPC message comes from a frame of this app. */
export function isTrustedSender(
  origin: string | undefined,
  devOrigin?: string,
): boolean {
  return (
    origin === APP_ORIGIN || (devOrigin !== undefined && origin === devOrigin)
  )
}

/**
 * Maps an app:// URL to a file under root, or null when the URL is not the
 * app's or the path would leave root.
 */
export function resolveAppAsset(root: string, url: string): string | null {
  if (!isAppUrl(url)) return null
  let path: string
  try {
    path = decodeURIComponent(new URL(url).pathname)
  } catch {
    return null
  }
  // Backslashes and colons have meaning in Windows paths; no asset uses them.
  if (/[\0\\:]/.test(path)) return null
  const normalized = posix.normalize(path === '/' ? '/index.html' : path)
  const file = join(root, normalized)
  const inside = relative(root, file)
  if (inside === '' || isAbsolute(inside) || inside.split(sep)[0] === '..')
    return null
  return file
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

export function contentType(file: string): string {
  return (
    CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
  )
}
