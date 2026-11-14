import { join, sep, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_ORIGIN,
  CONTENT_SECURITY_POLICY,
  contentType,
  devUserData,
  isAllowedRequest,
  isAppUrl,
  isTrustedSender,
  refusedSwitches,
  resolveAppAsset,
  windowWebPreferences,
} from '../../src/main/security'
import switches from '../../src/main/switches.json' with { type: 'json' }

const DEV = 'http://localhost:5173'

const present =
  (...names: string[]) =>
  (name: string) =>
    names.includes(name)

describe('refusedSwitches', () => {
  it.each(switches.sandboxOff)('refuses --%s in every build', (name) => {
    expect(refusedSwitches(present(name), false)).toEqual([name])
    expect(refusedSwitches(present(name), true)).toEqual([name])
  })

  it.each(switches.remoteDebugging)(
    'refuses --%s only when packaged',
    (name) => {
      expect(refusedSwitches(present(name), true)).toEqual([name])
      expect(refusedSwitches(present(name), false)).toEqual([])
    },
  )

  it('accepts other switches', () => {
    expect(refusedSwitches(present('lang', 'enable-logging'), true)).toEqual([])
  })
})

describe('devUserData', () => {
  const appData = '/home/fake/.config'

  it('gives an unpackaged run a directory of its own', () => {
    expect(devUserData(present('lang'), false, appData)).toBe(
      '/home/fake/.config/local-ledger-dev',
    )
  })

  it('leaves the packaged app and a named directory alone', () => {
    expect(devUserData(present(), true, appData)).toBeUndefined()
    expect(
      devUserData(present('user-data-dir'), false, appData),
    ).toBeUndefined()
  })
})

describe('windowWebPreferences', () => {
  it('isolates and sandboxes the renderer', () => {
    expect(windowWebPreferences('/app/preload.js', true)).toMatchObject({
      preload: '/app/preload.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      spellcheck: false,
      devTools: false,
    })
  })

  it('keeps DevTools for unpackaged builds only', () => {
    expect(windowWebPreferences('/p.js', false).devTools).toBe(true)
  })
})

describe('CONTENT_SECURITY_POLICY', () => {
  const directives = new Map(
    CONTENT_SECURITY_POLICY.split(';').map((part) => {
      const [name = '', ...sources] = part.trim().split(/\s+/)
      return [name, sources]
    }),
  )

  it('denies by default and runs only the app’s own scripts', () => {
    expect(directives.get('default-src')).toEqual(["'none'"])
    expect(directives.get('script-src')).toEqual(["'self'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
    expect(directives.get('base-uri')).toEqual(["'none'"])
    expect(directives.get('frame-ancestors')).toEqual(["'none'"])
  })

  it('allows no inline code, eval or remote source', () => {
    const sources = [...directives.values()].flat()
    expect(sources).not.toContain("'unsafe-inline'")
    expect(sources).not.toContain("'unsafe-eval'")
    expect(sources.filter((s) => /^(https?|wss?):|\*/.test(s))).toEqual([])
  })
})

describe('isAppUrl', () => {
  it.each([
    `${APP_ORIGIN}/`,
    `${APP_ORIGIN}/index.html`,
    `${APP_ORIGIN}/assets/a.js?v=1`,
  ])('accepts %s', (url) => expect(isAppUrl(url)).toBe(true))

  it.each([
    'app://other/index.html',
    'app://local-ledger.evil/index.html',
    'app://user:pass@local-ledger/index.html',
    'app://local-ledger:8080/index.html',
    'http://local-ledger/index.html',
    'https://evil.example/?next=app://local-ledger/',
    'https://evil.example/#app://local-ledger/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<p>hi</p>',
    'not a url',
  ])('rejects %s', (url) => expect(isAppUrl(url)).toBe(false))
})

describe('isAllowedRequest', () => {
  it('allows the app and local data', () => {
    expect(isAllowedRequest(`${APP_ORIGIN}/assets/a.js`)).toBe(true)
    expect(isAllowedRequest('data:image/png;base64,AAAA')).toBe(true)
    expect(isAllowedRequest('blob:app://local-ledger/1234')).toBe(true)
  })

  it.each([
    'https://example.com/',
    'http://localhost:5173/src/main.tsx',
    'ws://localhost:5173/',
    'file:///etc/passwd',
    'ftp://example.com/',
  ])('cancels %s outside development', (url) =>
    expect(isAllowedRequest(url)).toBe(false),
  )

  it('allows the dev server only when one is given', () => {
    expect(isAllowedRequest(`${DEV}/src/main.tsx`, DEV)).toBe(true)
    expect(isAllowedRequest('ws://localhost:5173/', DEV)).toBe(true)
    expect(isAllowedRequest('http://localhost:5174/', DEV)).toBe(false)
    expect(isAllowedRequest('http://user@localhost:5173/', DEV)).toBe(false)
    expect(isAllowedRequest('https://example.com/', DEV)).toBe(false)
  })
})

describe('isTrustedSender', () => {
  it('trusts the app origin', () => {
    expect(isTrustedSender(APP_ORIGIN)).toBe(true)
  })

  it.each([
    undefined,
    'null',
    '',
    'app://local-ledger.evil',
    'https://example.com',
    DEV,
  ])('distrusts %s in production', (origin) =>
    expect(isTrustedSender(origin)).toBe(false),
  )

  it('trusts the dev server only when one is given', () => {
    expect(isTrustedSender(DEV, DEV)).toBe(true)
    expect(isTrustedSender('http://localhost:5174', DEV)).toBe(false)
  })
})

describe('resolveAppAsset', () => {
  const root = join(sep, 'opt', 'ledger', 'renderer')
  const inside = (file: string | null) =>
    file === null || file.startsWith(root + sep)

  it('maps app URLs to files under root', () => {
    expect(resolveAppAsset(root, `${APP_ORIGIN}/`)).toBe(
      join(root, 'index.html'),
    )
    expect(resolveAppAsset(root, `${APP_ORIGIN}/assets/index-1.js`)).toBe(
      join(root, 'assets', 'index-1.js'),
    )
  })

  it.each([
    '/../../etc/passwd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/..%2f..%2fetc%2fpasswd',
    '/assets/..%2f..%2f..%2fetc%2fpasswd',
    '/%2e%2e%5c%2e%2e%5cwindows',
    '/C:%5CWindows%5Cwin.ini',
    '/index.html:stream',
    '/index.html%00.png',
  ])('keeps %s under root', (path) => {
    expect(inside(resolveAppAsset(root, `${APP_ORIGIN}${path}`))).toBe(true)
  })

  it.each([
    '/%5c..%5c..%5cwindows',
    '/C:%5CWindows%5Cwin.ini',
    '/index.html:stream',
    '/index.html%00.png',
    '/%E0%A4%A',
  ])('rejects %s', (path) => {
    expect(resolveAppAsset(root, `${APP_ORIGIN}${path}`)).toBeNull()
  })

  it('rejects URLs of other origins', () => {
    expect(resolveAppAsset(root, 'app://other/index.html')).toBeNull()
    expect(resolveAppAsset(root, 'file:///etc/passwd')).toBeNull()
  })

  describe('with Windows path rules', () => {
    const root = 'C:\\Ledger\\resources\\renderer'
    const resolve = (path: string) =>
      resolveAppAsset(root, `${APP_ORIGIN}${path}`, win32)

    it('maps app URLs to files under root', () => {
      expect(resolve('/')).toBe(`${root}\\index.html`)
      expect(resolve('/assets/index-1.js')).toBe(`${root}\\assets\\index-1.js`)
    })

    it.each([
      '/..%2f..%2f..%2fledger.db',
      '/assets/..%2f..%2f..%2f..%2fUsers%2fme%2fledger.db',
    ])('keeps %s under root', (path) => {
      const file = resolve(path)
      expect(file === null || file.startsWith(`${root}\\`)).toBe(true)
    })

    it.each([
      '/..%5c..%5cledger.db',
      '/%5c%5cserver%5cshare%5cledger.db',
      '/C:%2fUsers%2fme%2fledger.db',
      '/D:ledger.db',
      '/index.html::$DATA',
      '/CON',
      '/nul.txt',
      '/assets/COM1.js',
      '/assets/lpt9',
    ])('rejects %s', (path) => {
      expect(resolve(path)).toBeNull()
    })
  })
})

describe('contentType', () => {
  it('names the types the renderer build uses', () => {
    expect(contentType('/r/index.html')).toBe('text/html; charset=utf-8')
    expect(contentType('/r/assets/a.JS')).toBe('text/javascript; charset=utf-8')
    expect(contentType('/r/assets/a.css')).toBe('text/css; charset=utf-8')
    expect(contentType('/r/unknown.bin')).toBe('application/octet-stream')
  })
})
