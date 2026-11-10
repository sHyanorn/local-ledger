import { readFileSync } from 'node:fs'
import { _electron as electron, expect, test as base } from '@playwright/test'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { DEMO_PASSWORD } from '../../scripts/seed/demo'
import { generateLedger } from '../../scripts/seed/generate'
import type { SeedLedger } from '../../scripts/seed/generate'
import { insertLedger } from '../../scripts/seed/insert'
import { deriveHere } from '../../src/main/vault/kdf'
import { Vault } from '../../src/main/vault/vault'
import type { Channel } from '../../src/shared/ipc'
import { FAST, PASSWORD } from '../support/vault'

export { expect } from '@playwright/test'
export { PASSWORD } from '../support/vault'

/** Apps a test has already closed. */
const closed = new WeakSet<ElectronApplication>()

/** Starts the app on a user data directory of its own. */
export async function launch(
  userData: string,
  extraArgs: string[] = [],
): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, ...extraArgs, '.'],
    // Playwright turns the Chromium sandbox off on Linux unless asked to keep it.
    chromiumSandbox: true,
  })
  // CI machines get no keyboard or mouse input, so their system idle time
  // can be past the auto-lock limit, which would lock the vault mid-test.
  // Once the first page has loaded, and before the first idle check five
  // seconds in, the system reads as busy; the auto-lock test sets its own.
  app.once('close', () => closed.add(app))
  await (await app.firstWindow()).waitForLoadState('load')
  await app.evaluate(({ powerMonitor }) => {
    powerMonitor.getSystemIdleTime = () => 0
  })
  return app
}

/** The OS process of the page currently shown by the app. */
export function rendererPid(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ webContents }) => {
    const page = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('app://'))
    if (!page) throw new Error('no app page')
    return page.getOSProcessId()
  })
}

/** The page's next call on this channel fails, as one the main process cannot answer. */
export const failNext = (app: ElectronApplication, channel: Channel) =>
  app.evaluate(({ webContents }, channel) => {
    const page = webContents
      .getAllWebContents()
      .find(
        (contents) =>
          !contents.isDestroyed() && contents.getURL().startsWith('app://'),
      )
    if (!page) throw new Error('no app page')
    page.ipc.handleOnce(channel, () => {
      throw new Error('failed')
    })
  }, channel)

/** The first call on this channel from the next page the app opens fails. */
export const failOnNextPage = (app: ElectronApplication, channel: Channel) =>
  app.evaluate(({ app }, channel) => {
    app.once('web-contents-created', (_event, contents) => {
      contents.ipc.handleOnce(channel, () => {
        throw new Error('failed')
      })
    })
  }, channel)

/** Resolves once the process is gone, or fails after a few seconds. */
export async function expectExited(pid: number): Promise<void> {
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0)
        return 'running'
      } catch {
        return 'exited'
      }
    })
    .toBe('exited')
}

/** Runs an action that makes the app replace its page, and returns the new page. */
export async function replacedBy(
  app: ElectronApplication,
  action: () => Promise<unknown>,
): Promise<Page> {
  const next = app.waitForEvent('window')
  await action()
  const page = await next
  await page.waitForLoadState('load')
  return page
}

/** The app's sidebar. */
export const sidebar = (page: Page) =>
  page.getByRole('navigation', { name: 'Ledger' })

/** Unlocks from the locked page and returns the page that replaces it. */
export async function unlock(
  app: ElectronApplication,
  page: Page,
  password = DEMO_PASSWORD,
): Promise<Page> {
  await page.getByLabel('Master password').fill(password)
  return replacedBy(app, () =>
    page.getByRole('button', { name: 'Unlock' }).click(),
  )
}

/** Locks as the screen locking does, and returns the locked page. */
export const lockScreen = (app: ElectronApplication) =>
  replacedBy(app, () =>
    app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('lock-screen')
    }),
  )

/** Has the open or save dialog answer with this path, or as cancelled for null. */
function stubDialog(
  app: ElectronApplication,
  kind: 'open' | 'save',
  path: string | null,
) {
  return app.evaluate(
    ({ dialog }, { kind, path }) => {
      // Each answer records whether the app asked for it; see dialogsAsked.
      const stub = { kind, asked: false }
      const shared = globalThis as { dialogStubs?: (typeof stub)[] }
      ;(shared.dialogStubs ??= []).push(stub)
      if (kind === 'open') {
        dialog.showOpenDialog = (async () => {
          stub.asked = true
          return {
            canceled: path === null,
            filePaths: path === null ? [] : [path],
          }
        }) as typeof dialog.showOpenDialog
      } else {
        dialog.showSaveDialog = (async () => {
          stub.asked = true
          return { canceled: path === null, filePath: path ?? '' }
        }) as typeof dialog.showSaveDialog
      }
    },
    { kind, path },
  )
}

/** The open dialog answers with this file, or as cancelled for null. */
export const chooseFile = (app: ElectronApplication, path: string | null) =>
  stubDialog(app, 'open', path)

/** The save dialog answers with this path, or as cancelled for null. */
export const saveTo = (app: ElectronApplication, path: string | null) =>
  stubDialog(app, 'save', path)

/**
 * Fails a test that set a dialog answer the app never asked for, so a test
 * cannot pass without reaching the dialog it means to.
 */
export async function expectDialogsAsked(
  app: ElectronApplication,
): Promise<void> {
  if (closed.has(app)) return
  const unasked = await app.evaluate(() =>
    (
      (globalThis as { dialogStubs?: { kind: string; asked: boolean }[] })
        .dialogStubs ?? []
    )
      .filter((stub) => !stub.asked)
      .map((stub) => stub.kind),
  )
  expect(unasked, 'dialog answers the app never asked for').toEqual([])
}

/**
 * A heap snapshot of the main process, as text. Snapshots keep strings
 * whole when the app runs with a high string limit, as ledgerTest does.
 */
export async function mainHeapSnapshot(
  app: ElectronApplication,
  testInfo: TestInfo,
): Promise<string> {
  const file = testInfo.outputPath('main.heapsnapshot')
  await app.evaluate((_electron, path) => {
    process.getBuiltinModule('v8').writeHeapSnapshot(path)
  }, file)
  return readFileSync(file, 'utf8')
}

/** Creates the vault through the setup page and returns the unlocked page. */
export async function createVault(
  app: ElectronApplication,
  page: Page,
  password = PASSWORD,
): Promise<Page> {
  await page.getByLabel('Master password').fill(password)
  await page.getByLabel('Confirm password').fill(password)
  return replacedBy(app, () =>
    page.getByRole('button', { name: 'Create Vault' }).click(),
  )
}

export const test = base.extend<{
  userData: string
  app: ElectronApplication
  page: Page
}>({
  // Playwright reads fixture dependencies from this pattern, so it must stay.
  // oxlint-disable-next-line no-empty-pattern
  userData: async ({}, provide, testInfo) => {
    await provide(testInfo.outputPath('user-data'))
  },
  app: async ({ userData }, provide) => {
    const app = await launch(userData)
    await provide(app)
    try {
      await expectDialogsAsked(app)
    } finally {
      await app.close()
    }
  },
  page: async ({ app }, provide) => {
    await provide(await app.firstWindow())
  },
})

/** Writes a locked vault of seeded fake data, as the app would find it. */
async function seedVault(userData: string): Promise<SeedLedger> {
  const vault = new Vault(userData, { derive: deriveHere, kdf: FAST })
  const created = await vault.create(DEMO_PASSWORD)
  if (!created.ok) throw new Error(`seed vault: ${created.reason}`)
  const ledger = generateLedger()
  insertLedger(vault.database(), ledger)
  vault.lock()
  return ledger
}

/**
 * The app on a seeded vault: `ledger` is the fake data written, `home` the
 * page after unlocking it.
 */
export const ledgerTest = test.extend<{ ledger: SeedLedger; home: Page }>({
  ledger: async ({ userData }, provide) => {
    await provide(await seedVault(userData))
  },
  app: async ({ userData, ledger }, provide) => {
    if (!ledger) throw new Error('seed first')
    // Heap snapshots keep strings whole, so a residue search sees all of them.
    const app = await launch(userData, [
      '--js-flags=--heap-snapshot-string-limit=1000000000',
    ])
    await provide(app)
    try {
      await expectDialogsAsked(app)
    } finally {
      await app.close()
    }
  },
  home: async ({ app, page }, provide) => {
    const home = await unlock(app, page)
    await expect(sidebar(home)).toBeVisible()
    // Overview opens first; most tests start from the transaction list.
    await expect(
      sidebar(home).getByRole('button', { name: 'Overview' }),
    ).toHaveAttribute('aria-current', 'page')
    await sidebar(home)
      .getByRole('button', { name: 'All Transactions' })
      .click()
    // A CSP violation is logged as a console error, so this also fails a
    // test whose page tried eval or a remote load.
    const problems: string[] = []
    home.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text())
    })
    home.on('pageerror', (error) => problems.push(error.message))
    await provide(home)
    expect(problems).toEqual([])
  },
})
