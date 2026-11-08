import type { Page } from '@playwright/test'
import { expect, ledgerTest } from './fixtures'

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Ledger' })

ledgerTest(
  'a budget shows spending against it, counts when over, and can end',
  async ({ home }) => {
    await sidebar(home)
      .getByRole('button', { name: /^Budgets/ })
      .click()
    const groceries = home
      .getByRole('listitem')
      .filter({ has: home.getByText('Groceries', { exact: true }) })
    await expect(groceries).toContainText('spent')

    // A budget far below this month's spending is over at once.
    await groceries
      .getByRole('button', { name: 'Set budget for Groceries' })
      .click()
    await groceries.getByLabel(/^Budget for Groceries from/).fill('1')
    await groceries.getByRole('button', { name: 'Save' }).click()
    await expect(groceries).toContainText(/over \$1\.00/)
    await expect(
      sidebar(home).getByRole('button', { name: 'Budgets 1 over budget' }),
    ).toBeVisible()

    // Moving on a month keeps the budget; ending it there leaves this month's.
    await home.getByRole('button', { name: 'Next Month' }).click()
    await expect(
      groceries.getByRole('button', { name: 'Change budget for Groceries' }),
    ).toBeVisible()
    await groceries
      .getByRole('button', { name: 'Change budget for Groceries' })
      .click()
    await groceries.getByLabel(/^Budget for Groceries from/).fill('')
    await groceries.getByRole('button', { name: 'Save' }).click()
    await expect(
      groceries.getByRole('button', { name: 'Set budget for Groceries' }),
    ).toBeVisible()
    await home.getByRole('button', { name: 'Previous Month' }).click()
    await expect(groceries).toContainText(/over \$1\.00/)
  },
)

ledgerTest(
  'going over a budget is said once, over the transactions',
  async ({ home }) => {
    await sidebar(home)
      .getByRole('button', { name: /^Budgets/ })
      .click()
    const coffee = home
      .getByRole('listitem')
      .filter({ has: home.getByText('Coffee', { exact: true }) })
    await coffee.getByRole('button', { name: 'Set budget for Coffee' }).click()
    await coffee.getByLabel(/^Budget for Coffee from/).fill('100000')
    await coffee.getByRole('button', { name: 'Save' }).click()
    await expect(coffee).toContainText(/of \$100,000\.00/)

    await sidebar(home)
      .getByRole('button', { name: 'All Transactions' })
      .click()
    await home.getByRole('button', { name: 'Add Transaction' }).click()
    const dialog = home.getByRole('dialog', { name: 'New Transaction' })
    await dialog.getByLabel('Description').fill('Fake Espresso Machine')
    await dialog.getByLabel('Amount').fill('100000')
    await dialog.getByLabel('Category').selectOption({ label: 'Food › Coffee' })
    await dialog.getByRole('button', { name: 'Add Transaction' }).click()
    const notice = home.getByRole('region', { name: 'Budget notice' })
    await expect(notice).toContainText(
      /^Coffee is \$[\d,.]+ over its budget for /,
    )

    // Said once: a further change while still over says nothing more.
    await notice.getByRole('button', { name: 'Dismiss' }).click()
    await home.getByRole('button', { name: 'Add Transaction' }).click()
    await dialog.getByLabel('Description').fill('Fake Grinder')
    await dialog.getByLabel('Amount').fill('5')
    await dialog.getByLabel('Category').selectOption({ label: 'Food › Coffee' })
    await dialog.getByRole('button', { name: 'Add Transaction' }).click()
    await expect(dialog).toBeHidden()
    await expect(
      home.getByRole('row').filter({ hasText: 'Fake Grinder' }),
    ).toBeVisible()
    await expect(notice).toBeHidden()
  },
)
