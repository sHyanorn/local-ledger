import type { Page } from '@playwright/test'
import { expect, ledgerTest, replacedBy } from './fixtures'

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Ledger' })

ledgerTest(
  'the lock time setting decides when idle time locks the vault',
  async ({ app, home }) => {
    await sidebar(home).getByRole('button', { name: 'Settings' }).click()
    const lockAfter = home.getByLabel('Lock after idle')
    await expect(lockAfter).toHaveValue('5')
    // Two minutes idle is under the default.
    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.getSystemIdleTime = () => 120
    })
    await home.waitForTimeout(6_000)
    await expect(lockAfter).toBeVisible()

    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.getSystemIdleTime = () => 0
    })
    await lockAfter.selectOption('1')
    await expect
      .poll(() => home.evaluate(() => window.ledger.settings.get()))
      .toMatchObject({ idleLockMinutes: 1 })
    const locked = await replacedBy(app, () =>
      app.evaluate(({ powerMonitor }) => {
        powerMonitor.getSystemIdleTime = () => 60
      }),
    )
    expect(await locked.evaluate(() => window.ledger.vault.status())).toBe(
      'locked',
    )
  },
)

ledgerTest(
  'changing the home currency says how many budgets now count in it',
  async ({ home }) => {
    const month = await home.evaluate(async () => {
      const categories = await window.ledger.categories.list()
      const today = new Date()
      const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
      const top = categories.filter((category) => category.parentId === null)
      await window.ledger.budgets.set(top[0]!.id, month, 50_000)
      await window.ledger.budgets.set(top[1]!.id, month, 60_000)
      return month
    })
    expect(month).toMatch(/^\d{4}-\d{2}$/)
    await sidebar(home).getByRole('button', { name: 'Settings' }).click()
    await home.getByLabel('Home currency').selectOption('CNY')
    const confirm = home.getByRole('alertdialog', {
      name: 'Count budgets in CNY?',
    })
    await expect(confirm).toHaveAccessibleDescription(
      '2 budgets will count spending in CNY; amounts are not converted.',
    )
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(home.getByLabel('Home currency')).toHaveValue('AUD')

    await home.getByLabel('Home currency').selectOption('CNY')
    await confirm.getByRole('button', { name: 'Change Currency' }).click()
    await expect(home.getByLabel('Home currency')).toHaveValue('CNY')
    await sidebar(home)
      .getByRole('button', { name: /^Budgets/ })
      .click()
    await expect(home.getByText(/CNY\s500\.00/).first()).toBeVisible()
  },
)
