// Security policy as plain functions, kept free of Electron runtime imports
// so unit tests can check it directly. hardening.ts and protocol.ts apply it.
import nodePath from 'node:path'
import type { WebPreferences } from 'electron'
import switches from './switches.json'

export const APP_SCHEME = 'app'
const APP_HOST = 'local-ledger'
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

/** For a page printed to PDF: its own stylesheet, and nothing that runs. */
export const PRINT_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'self'",
  "script-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ')

/**
 * Command line switches the app refuses to start with: those that weaken the
 * Chromium sandbox, and in packaged builds those that open a debugging port.
 * The unpackaged build keeps the port, which Playwright drives it through.
 */
export function refusedSwitches(
  hasSwitch: (name: string) => boolean,
  packaged: boolean,
): string[] {
  const names = packaged
    ? [...switches.sandboxOff, ...switches.remoteDebugging]
    : switches.sandboxOff
  return names.filter(hasSwitch)
}

/**
 * The user data directory of an unpackaged run that names none. Electron
 * names the default after package.json, so a development build would
 * otherwise share the packaged app's directory, and open its vault.
 */
export function devUserData(
  hasSwitch: (name: string) => boolean,
  packaged: boolean,
  appData: string,
): string | undefined {
  return packaged || hasSwitch('user-data-dir')
    ? undefined
    : nodePath.join(appData, 'local-ledger-dev')
}

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
 * app's or the path would leave root. `path` is replaceable so tests can
 * apply Windows rules on any platform.
 */
export function resolveAppAsset(
  root: string,
  url: string,
  path: nodePath.PlatformPath = nodePath,
): string | null {
  if (!isAppUrl(url)) return null
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(url).pathname)
  } catch {
    return null
  }
  // Build output uses only these characters; anything else, such as the
  // backslashes, colons and NUL that mean something to file systems, is refused.
  if (!/^\/[\w./-]*$/.test(pathname)) return null
  // Windows treats these names as devices, not files.
  if (/\/(con|prn|aux|nul|com\d|lpt\d)(\.|\/|$)/i.test(pathname)) return null
  const normalized = path.posix.normalize(
    pathname === '/' ? '/index.html' : pathname,
  )
  const file = path.join(root, normalized)
  const inside = path.relative(root, file)
  if (
    inside === '' ||
    path.isAbsolute(inside) ||
    inside.split(path.sep)[0] === '..'
  )
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
    CONTENT_TYPES[nodePath.extname(file).toLowerCase()] ??
    'application/octet-stream'
  )
}
