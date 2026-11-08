import { spawnSync } from 'node:child_process'
import { readFileSync, readlinkSync } from 'node:fs'
import electron from 'electron'
import type { WebPreferences } from 'electron'
import pkg from '../../package.json' with { type: 'json' }
import { CONTENT_SECURITY_POLICY } from '../../src/main/security'
import switches from '../../src/main/switches.json' with { type: 'json' }
import { networkRequests } from '../native/net-log.mjs'
import {
  createVault,
  expect,
  launch,
  rendererPid,
  replacedBy,
  test,
} from './fixtures'

const APP_URL = 'app://local-ledger/index.html'
// Outside Electron, the electron package exports the path of its binary.
const electronBinary = electron as unknown as string

declare global {
  interface Window {
    violations?: string[]
  }
}

const SETUP_HEADING = { name: 'Create a master password' }

test('the app makes no network request', async ({ userData }, testInfo) => {
  // A fresh profile, so nothing Chromium cached on an earlier run hides a request.
  const log = testInfo.outputPath('net-log.json')
  const app = await launch(userData, [`--log-net-log=${log}`])
  try {
    const home = await createVault(app, await app.firstWindow())
    await replacedBy(app, () =>
      home.getByRole('button', { name: 'Lock' }).click(),
    )
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  } finally {
    await app.close()
  }
  expect(networkRequests(log)).toEqual([])
})

test('the page has the app origin', async ({ page }) => {
  expect(await page.evaluate(() => location.origin)).toBe('app://local-ledger')
  expect(page.url()).toBe(APP_URL)
})

test('loading the app raises no CSP violation or console problem', async ({
  page,
}) => {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  await page.addInitScript(() => {
    window.violations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      window.violations?.push(`${event.violatedDirective} ${event.blockedURI}`)
    })
  })
  await page.reload()
  await expect(page.getByRole('heading', SETUP_HEADING)).toBeVisible()
  expect(await page.evaluate(() => window.violations)).toEqual([])
  expect(problems).toEqual([])
})

test('every app response carries the CSP', async ({ page }) => {
  const responses: [string, string | undefined][] = []
  page.on('response', async (response) => {
    const headers = await response.allHeaders()
    responses.push([response.url(), headers['content-security-policy']])
  })
  await page.reload()
  await expect(page.getByRole('heading', SETUP_HEADING)).toBeVisible()
  expect(responses.map(([url]) => url)).toEqual(
    expect.arrayContaining([
      APP_URL,
      expect.stringMatching(/\.js$/),
      expect.stringMatching(/\.css$/),
    ]),
  )
  for (const [url, policy] of responses) {
    expect(url).toMatch(/^app:\/\/local-ledger\//)
    expect(policy).toBe(CONTENT_SECURITY_POLICY)
  }
})

test('the protocol serves only files of the renderer build', async ({
  app,
}) => {
  const responses = await app.evaluate(async ({ net }) => {
    const requests: [string, string][] = [
      ['GET', '/index.html'],
      ['GET', '/missing.js'],
      // The main and preload bundles sit next to the renderer build. Chromium
      // resolves plain and %2e dot segments itself; the rest reach the handler.
      ['GET', '/../main/index.js'],
      ['GET', '/%2e%2e/main/index.js'],
      ['GET', '/..%2fmain%2findex.js'],
      ['GET', '/..%5cpreload%5cindex.js'],
      ['POST', '/index.html'],
    ]
    return Promise.all(
      requests.map(async ([method, path]) => {
        const response = await net.fetch(`app://local-ledger${path}`, {
          method,
        })
        return [
          response.status,
          response.headers.get('content-security-policy') !== null,
        ]
      }),
    )
  })
  expect(responses).toEqual(
    [200, 404, 404, 404, 404, 404, 405].map((status) => [status, true]),
  )
})

test('the renderer has no Node.js', async ({ page }) => {
  const types = await page.evaluate(() => {
    const scope = globalThis as Record<string, unknown>
    return ['require', 'process', 'module', 'Buffer', 'electron'].map(
      (name) => typeof scope[name],
    )
  })
  expect(types).toEqual(Array(5).fill('undefined'))
})

test('preload exposes only the ledger API, read-only', async ({ page }) => {
  const api = await page.evaluate(() => {
    const ledger = window.ledger as unknown as Record<string, unknown>
    const vault = ledger.vault as Record<string, unknown>
    try {
      ledger.version = 'changed'
      ledger.extra = true
      delete ledger.version
      vault.unlock = () => 'replaced'
    } catch {
      // Writes to a frozen object throw in strict mode code.
    }
    const methods = (name: string) => Object.keys(ledger[name] as object).sort()
    return {
      keys: Object.keys(ledger),
      version: ledger.version,
      vault: methods('vault'),
      accounts: methods('accounts'),
      categories: methods('categories'),
      transactions: methods('transactions'),
      unlockReplaced: String(vault.unlock).includes('replaced'),
    }
  })
  expect(api).toEqual({
    keys: ['version', 'vault', 'accounts', 'categories', 'transactions'],
    version: pkg.version,
    vault: ['changePassword', 'create', 'lock', 'status', 'unlock'],
    accounts: ['create', 'delete', 'list', 'update'],
    categories: ['create', 'delete', 'list', 'update'],
    transactions: ['create', 'delete', 'page', 'totals', 'update'],
    unlockReplaced: false,
  })
})

test('the window runs isolated and sandboxed', async ({ app }) => {
  const prefs = await app.evaluate(({ webContents }) => {
    // Present at runtime, missing from Electron's typings.
    const contents = webContents
      .getAllWebContents()
      .find((page) => page.getURL().startsWith('app://')) as unknown as
      { getLastWebPreferences(): WebPreferences | null } | undefined
    const prefs = contents?.getLastWebPreferences()
    return {
      contextIsolation: prefs?.contextIsolation,
      sandbox: prefs?.sandbox,
      nodeIntegration: prefs?.nodeIntegration,
      webSecurity: prefs?.webSecurity,
      webviewTag: prefs?.webviewTag,
    }
  })
  expect(prefs).toEqual({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
  })
})

test('the operating system sandboxes the renderer process', async ({ app }) => {
  if (process.platform === 'linux') {
    const pid = await rendererPid(app)
    const mainPid = app.process().pid
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    expect(status).toMatch(/^Seccomp:\s+2$/m)
    expect(readlinkSync(`/proc/${pid}/ns/user`)).not.toBe(
      readlinkSync(`/proc/${mainPid}/ns/user`),
    )
  } else {
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics())
    const renderers = metrics.filter((metric) => metric.type === 'Tab')
    expect(renderers.length).toBeGreaterThan(0)
    expect(renderers.every((metric) => metric.sandboxed === true)).toBe(true)
  }
})

test('CSP blocks eval, inline code and remote loads', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const violations: string[] = []
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(event.violatedDirective)
    })
    const attempt = (run: () => unknown) => {
      try {
        run()
        return 'ran'
      } catch (error) {
        return (error as Error).name
      }
    }
    // Code evaluated by Playwright may compile strings; a timer callback runs
    // afterwards under the page's own policy.
    const later = <T>(run: () => T) =>
      new Promise<T>((resolve) => setTimeout(() => resolve(run()), 0))
    // oxlint-disable-next-line no-eval -- the test checks that CSP blocks it
    const evalResult = await later(() => attempt(() => eval('1 + 1')))
    const functionResult = await later(() =>
      attempt(() => new Function('return 1')()),
    )

    const script = document.createElement('script')
    script.textContent = 'window.inlineRan = true'
    document.body.append(script)

    // React writes style props through CSSOM, which CSP allows; a style
    // attribute is inline style, which it blocks.
    const viaAttribute = document.createElement('div')
    viaAttribute.setAttribute('style', 'color: rgb(1, 2, 3)')
    const viaCssom = document.createElement('div')
    viaCssom.style.color = 'rgb(4, 5, 6)'
    document.body.append(viaAttribute, viaCssom)

    const fetchResult = await fetch('https://example.com/').then(
      () => 'loaded',
      (error: Error) => error.name,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    return {
      evalResult,
      functionResult,
      inlineRan: (window as { inlineRan?: boolean }).inlineRan ?? false,
      attributeColor: getComputedStyle(viaAttribute).color,
      cssomColor: getComputedStyle(viaCssom).color,
      fetchResult,
      violations: [...new Set(violations)].sort(),
    }
  })
  expect(result).toEqual({
    evalResult: 'EvalError',
    functionResult: 'EvalError',
    inlineRan: false,
    attributeColor: expect.not.stringContaining('1, 2, 3'),
    cssomColor: 'rgb(4, 5, 6)',
    fetchResult: 'TypeError',
    violations: [
      'connect-src',
      'script-src',
      'script-src-elem',
      'style-src-attr',
    ],
  })
})

test('new windows are refused', async ({ app, page }) => {
  const opened = await page.evaluate(() => [
    window.open('https://example.com/'),
    window.open(location.href),
  ])
  await page.evaluate(() => {
    const link = document.createElement('a')
    link.href = 'https://example.com/'
    link.target = '_blank'
    document.body.append(link)
    link.click()
  })
  await page.waitForTimeout(300)
  expect(opened).toEqual([null, null])
  expect(app.windows()).toHaveLength(1)
})

test('navigation away from the page is refused', async ({ page }) => {
  for (const target of [
    'https://example.com/',
    'app://local-ledger/other.html',
    'file:///',
  ]) {
    await page.evaluate((url) => {
      location.href = url
    }, target)
    await page.waitForTimeout(300)
    expect(page.url()).toBe(APP_URL)
  }
})

test('permission requests are denied', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const geolocation = await new Promise<number | string>((resolve) =>
      navigator.geolocation.getCurrentPosition(
        () => resolve('granted'),
        (error) => resolve(error.code),
      ),
    )
    const states = await Promise.all(
      ['camera', 'microphone', 'clipboard-read', 'notifications'].map(
        async (name) =>
          (await navigator.permissions.query({ name: name as PermissionName }))
            .state,
      ),
    )
    return {
      notification: await Notification.requestPermission(),
      geolocation,
      states,
    }
  })
  expect(result).toEqual({
    notification: 'denied',
    geolocation: 1,
    states: ['denied', 'denied', 'denied', 'denied'],
  })
})

for (const name of switches.sandboxOff) {
  test(`the app refuses to start with --${name}`, async () => {
    // Either the main process refuses, or on Linux Chromium aborts first
    // because no other sandbox is left.
    const refusal = new RegExp(
      `Refusing to start with --${name}\\.|Rather than run without sandboxing`,
    )
    const result = spawnSync(electronBinary, [`--${name}`, '.'], {
      encoding: 'utf8',
      timeout: 15_000,
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(refusal)
  })
}
