import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { chooseFile, expect, ledgerTest, sidebar } from './fixtures'

const list = (page: Page) => page.getByRole('table', { name: 'Transactions' })

async function setCategory(page: Page, nth: number, category: string) {
  const row = list(page)
    .getByRole('row')
    .filter({ hasText: 'Paper Plane Coffee' })
    .nth(nth)
  await row.getByRole('button', { name: /^Category of/ }).click()
  await row.getByRole('combobox').selectOption({ label: category })
  await expect(row).toContainText(category)
  return row
}

async function showCoffee(page: Page) {
  await sidebar(page)
    .getByRole('button', { name: /^Everyday/ })
    .click()
  await page
    .getByRole('searchbox', { name: 'Search' })
    .fill('Paper Plane Coffee')
  await expect(
    list(page).getByRole('row').filter({ hasText: 'Paper Plane Coffee' }),
  ).not.toHaveCount(0)
}

ledgerTest(
  'a manual category offers a rule, which categorizes the rest and later imports',
  async ({ app, home }) => {
    await showCoffee(home)
    // One left uncategorized, for the new rule to pick up.
    const second = await setCategory(home, 1, 'Uncategorized')
    await setCategory(home, 0, 'Food › Dining Out')

    const bar = home.getByRole('region', { name: 'Rule suggestion' })
    await expect(bar).toContainText(
      'Put “Paper Plane Coffee” in Food › Dining Out from now on?',
    )
    await bar.getByRole('button', { name: 'Create Rule…' }).click()
    const dialog = home.getByRole('dialog', { name: 'New Rule' })
    await expect(dialog.getByLabel('Text')).toHaveValue('Paper Plane Coffee')
    const apply = dialog.getByRole('checkbox', {
      name: 'Categorize 1 uncategorized transaction',
    })
    await expect(apply).toBeChecked()
    await dialog.getByRole('button', { name: 'Add Rule' }).click()
    await expect(bar).toHaveCount(0)
    await expect(second).toContainText('Food › Dining Out')

    await sidebar(home).getByRole('button', { name: 'Settings' }).click()
    await expect(
      home.getByRole('region', { name: 'Rules' }).getByRole('button', {
        name: /Contains “Paper Plane Coffee”\s*Food › Dining Out/,
      }),
    ).toBeVisible()

    // A later import gets its category from a rule.
    await chooseFile(app, resolve(__dirname, '../fixtures/csv/anz.csv'))
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
  await showCoffee(home)
  await setCategory(home, 0, 'Food › Dining Out')
  const bar = home.getByRole('region', { name: 'Rule suggestion' })
  await bar.getByRole('button', { name: 'Don’t Ask Again' }).click()
  await expect(bar).toHaveCount(0)

  await setCategory(home, 1, 'Food › Dining Out')
  await expect(bar).toHaveCount(0)
})
