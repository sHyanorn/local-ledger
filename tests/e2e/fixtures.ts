import { _electron as electron, expect, test as base } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { DEMO_PASSWORD } from '../../scripts/seed/demo'
import { generateLedger } from '../../scripts/seed/generate'
import type { SeedLedger, SeedOptions } from '../../scripts/seed/generate'
import { insertLedger } from '../../scripts/seed/insert'
import { deriveHere } from '../../src/main/vault/kdf'
import { Vault } from '../../src/main/vault/vault'

export { expect } from '@playwright/test'

export const PASSWORD = 'fake ledger passphrase for tests'

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
    await (await app.firstWindow()).waitForLoadState('load')
    await provide(app)
    await app.close()
  },
  page: async ({ app }, provide) => {
    await provide(await app.firstWindow())
  },
})

/** Fast key derivation for test vaults; vault.json records it. */
const TEST_KDF = { memoryKiB: 19_456, iterations: 2, parallelism: 1 }

/** Writes a locked vault of seeded fake data, as the app would find it. */
export async function seedVault(
  userData: string,
  options: SeedOptions = {},
): Promise<SeedLedger> {
  const vault = new Vault(userData, { derive: deriveHere, kdf: TEST_KDF })
  const created = await vault.create(DEMO_PASSWORD)
  if (!created.ok) throw new Error(`seed vault: ${created.reason}`)
  const ledger = generateLedger(options)
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
    await (await app.firstWindow()).waitForLoadState('load')
    await provide(app)
    await app.close()
  },
  home: async ({ app, page }, provide) => {
    await page.getByLabel('Master password').fill(DEMO_PASSWORD)
    const home = await replacedBy(app, () =>
      page.getByRole('button', { name: 'Unlock' }).click(),
    )
    await expect(home.getByRole('navigation', { name: 'Ledger' })).toBeVisible()
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
