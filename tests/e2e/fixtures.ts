import { _electron as electron, test as base } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

export { expect } from '@playwright/test'

export const test = base.extend<{ app: ElectronApplication; page: Page }>({
  // Playwright reads fixture dependencies from this pattern, so it must stay.
  // oxlint-disable-next-line no-empty-pattern
  app: async ({}, provide) => {
    // Playwright turns the Chromium sandbox off on Linux unless asked to keep it.
    const app = await electron.launch({ args: ['.'], chromiumSandbox: true })
    await provide(app)
    await app.close()
  },
  page: async ({ app }, provide) => {
    await provide(await app.firstWindow())
  },
})
