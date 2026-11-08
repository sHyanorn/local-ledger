import { _electron as electron, expect, test as base } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

export { expect } from '@playwright/test'

export const PASSWORD = 'fake ledger passphrase for tests'

/** Starts the app on a user data directory of its own. */
export function launch(
  userData: string,
  extraArgs: string[] = [],
): Promise<ElectronApplication> {
  return electron.launch({
    args: [`--user-data-dir=${userData}`, ...extraArgs, '.'],
    // Playwright turns the Chromium sandbox off on Linux unless asked to keep it.
    chromiumSandbox: true,
  })
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
