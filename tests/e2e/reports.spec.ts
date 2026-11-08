import type { Page } from '@playwright/test'
import { expect, ledgerTest } from './fixtures'

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Ledger' })

ledgerTest(
  'overview shows this month and reports draw their charts',
  async ({ home }) => {
    await sidebar(home).getByRole('button', { name: 'Overview' }).click()
    await expect(
      sidebar(home).getByRole('button', { name: 'Overview' }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(
      home.getByText('Spending', { exact: true }).first(),
    ).toBeVisible()
    const recent = home.getByRole('region', { name: 'Recent Transactions' })
    await expect(recent.getByRole('listitem')).toHaveCount(5)
    await recent.getByRole('button', { name: 'All Transactions' }).click()
    await expect(
      sidebar(home).getByRole('button', { name: 'All Transactions' }),
    ).toHaveAttribute('aria-current', 'page')

    await sidebar(home).getByRole('button', { name: 'Reports' }).click()
    const months = home.getByRole('img', {
      name: /^Income and spending by month/,
    })
    await expect(months.locator('rect.bar.income')).toHaveCount(12)
    await expect(months.locator('rect.bar.spending')).toHaveCount(12)
    const categories = home.getByRole('img', { name: /^Spending by category/ })
    await expect(categories.locator('rect.bar').first()).toBeVisible()
    const trend = home.getByRole('img', { name: /^Spending on / })
    await expect(trend.locator('rect.dot')).toHaveCount(12)

    // Another category's trend, and the month before.
    const choice = home.getByLabel('Category for the trend')
    const second = await choice.locator('option').nth(1).textContent()
    await choice.selectOption({ index: 1 })
    await expect(
      home.getByRole('img', { name: `Spending on ${second} by month` }),
    ).toBeVisible()
    await home.getByRole('button', { name: 'Previous Month' }).click()
    await expect(months.locator('rect.bar.income')).toHaveCount(12)
  },
)
