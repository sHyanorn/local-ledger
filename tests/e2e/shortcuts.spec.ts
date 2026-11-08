import type { ElectronApplication, Page } from '@playwright/test'
import { expect, ledgerTest, replacedBy } from './fixtures'

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Ledger' })
const current = (page: Page, name: string | RegExp) =>
  expect(sidebar(page).getByRole('button', { name })).toHaveAttribute(
    'aria-current',
    'page',
  )
const menu = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, id) => {
    Menu.getApplicationMenu()?.getMenuItemById(id)?.click()
  }, id)

ledgerTest('menu commands move between pages', async ({ app, home }) => {
  for (const [id, name] of [
    ['overview', 'Overview'],
    ['budgets', /^Budgets/],
    ['reports', 'Reports'],
    ['transfers', /^Transfers/],
    ['settings', 'Settings'],
    ['transactions', 'All Transactions'],
  ] as const) {
    await menu(app, id)
    await current(home, name)
  }
})

ledgerTest(
  'new transaction and find open the transaction list where needed',
  async ({ app, home }) => {
    await menu(app, 'reports')
    await menu(app, 'new-transaction')
    const dialog = home.getByRole('dialog', { name: 'New Transaction' })
    await expect(dialog).toBeVisible()
    await home.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await menu(app, 'budgets')
    await menu(app, 'find')
    await expect(home.getByRole('searchbox', { name: 'Search' })).toBeFocused()
  },
)

ledgerTest('a locked vault ignores menu commands', async ({ app, home }) => {
  // Shortcuts are native menu accelerators; the menu unit test checks them.
  const locked = await replacedBy(app, () =>
    sidebar(home).getByRole('button', { name: 'Lock' }).click(),
  )
  await expect(locked.getByLabel('Master password')).toBeVisible()
  // Count what the main process sends to any page.
  await app.evaluate(({ webContents }) => {
    for (const contents of webContents.getAllWebContents()) {
      const send = contents.send.bind(contents)
      contents.send = (...args: Parameters<typeof send>) => {
        const count = (globalThis as { sent?: number }).sent ?? 0
        Object.assign(globalThis, { sent: count + 1 })
        send(...args)
      }
    }
  })
  await menu(app, 'new-transaction')
  await menu(app, 'budgets')
  expect(
    await app.evaluate(() => (globalThis as { sent?: number }).sent ?? 0),
  ).toBe(0)
  await expect(locked.getByRole('dialog')).toHaveCount(0)
  await expect(locked.getByLabel('Master password')).toBeVisible()
})
