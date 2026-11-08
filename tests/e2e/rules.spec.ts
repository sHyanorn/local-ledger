import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, ledgerTest } from './fixtures'

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Ledger' })
const list = (page: Page) => page.getByRole('table', { name: 'Transactions' })

async function categorizeFirst(page: Page, text: string, category: string) {
  await page.getByRole('searchbox', { name: 'Search' }).fill(text)
  const row = list(page).getByRole('row').filter({ hasText: text }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /^Category of/ }).click()
  await row.getByRole('combobox').selectOption({ label: category })
}

ledgerTest(
  'a manual category offers a rule, which categorizes the rest and later imports',
  async ({ app, home }) => {
    await sidebar(home)
      .getByRole('button', { name: /^Everyday/ })
      .click()
    await categorizeFirst(home, 'Transfer to Savings', 'Travel')

    const bar = home.getByRole('region', { name: 'Rule suggestion' })
    await expect(bar).toContainText(
      'Put “Transfer to Savings” in Travel from now on?',
    )
    await bar.getByRole('button', { name: 'Create Rule…' }).click()
    const dialog = home.getByRole('dialog', { name: 'New Rule' })
    await expect(dialog.getByLabel('Text')).toHaveValue('Transfer to Savings')
    const apply = dialog.getByRole('checkbox', {
      name: /^Categorize \d+ uncategorized/,
    })
    await expect(apply).toBeChecked()
    await dialog.getByRole('button', { name: 'Add Rule' }).click()
    await expect(bar).toHaveCount(0)
    await expect(
      list(home)
        .getByRole('row')
        .filter({ hasText: 'Transfer to Savings' })
        .filter({ hasText: 'Uncategorized' }),
    ).toHaveCount(0)

    await sidebar(home).getByRole('button', { name: 'Settings' }).click()
    await expect(
      home.getByRole('region', { name: 'Rules' }).getByRole('button', {
        name: /Contains “Transfer to Savings”\s*Travel/,
      }),
    ).toBeVisible()

    // A later import gets the category from the rule.
    await app.evaluate(
      ({ dialog }, path) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [path],
        })) as typeof dialog.showOpenDialog
      },
      resolve(__dirname, '../fixtures/csv/anz.csv'),
    )
    await home.evaluate(async () => {
      const categories = await window.ledger.categories.list()
      const travel = categories.find((category) => category.name === 'Travel')!
      await window.ledger.rules.create({
        pattern: 'fake savings',
        match: 'contains',
        categoryId: travel.id,
        apply: false,
      })
    })
    await sidebar(home)
      .getByRole('button', { name: /^Savings/ })
      .click()
    await home.getByRole('button', { name: 'Import CSV…' }).click()
    const preview = home.getByRole('table', { name: 'Rows to import' })
    await expect(
      preview.getByRole('row').filter({ hasText: 'TRANSFER TO FAKE SAVINGS' }),
    ).toContainText('Travel')
  },
)

ledgerTest('a declined payee is not offered again', async ({ home }) => {
  await sidebar(home)
    .getByRole('button', { name: /^Everyday/ })
    .click()
  await categorizeFirst(home, 'Transfer to Savings', 'Travel')
  const bar = home.getByRole('region', { name: 'Rule suggestion' })
  await bar.getByRole('button', { name: 'Don’t Ask Again' }).click()
  await expect(bar).toHaveCount(0)

  const rows = list(home)
    .getByRole('row')
    .filter({ hasText: 'Transfer to Savings' })
  await rows
    .nth(1)
    .getByRole('button', { name: /^Category of/ })
    .click()
  await rows.nth(1).getByRole('combobox').selectOption({ label: 'Travel' })
  await expect(rows.nth(1)).toContainText('Travel')
  await expect(bar).toHaveCount(0)
})
