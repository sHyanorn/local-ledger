import type { Page } from '@playwright/test'
import { formatAmount } from '../../src/shared/money'
import { expect, ledgerTest as test, sidebar } from './fixtures'

const accountButton = (page: Page, name: string) =>
  sidebar(page).getByRole('button', { name: new RegExp(`^${name}`) })

test('the sidebar lists every account with its balance in its own currency', async ({
  home,
  ledger,
}) => {
  const names = await sidebar(home)
    .getByRole('list', { name: 'Accounts' })
    .getByRole('button')
    .locator('.name')
    .allTextContents()
  expect(names).toEqual(['Credit Card', 'Everyday', 'Savings', 'Travel Cash'])

  for (const account of ledger.accounts) {
    const cents =
      account.openingBalanceCents +
      ledger.transactions
        .filter((row) => row.account === account.name)
        .reduce((sum, row) => sum + row.amountCents, 0)
    const shown = await accountButton(home, account.name)
      .locator('.amount')
      .textContent()
    if (account.currency === 'AUD') {
      expect(shown).toBe(formatAmount(cents, 'AUD'))
    } else {
      // The yuan symbol differs between ICU builds; the digits do not.
      expect(shown).toContain(formatAmount(cents, 'AUD').replace(/^-?\$/, ''))
    }
  }
})

test('an account is added, renamed and deleted', async ({ home }) => {
  await sidebar(home).getByRole('button', { name: 'Add Account' }).click()
  const dialog = home.getByRole('dialog', { name: 'New Account' })
  await dialog.getByLabel('Name').fill('Fake Wallet')
  await dialog.getByLabel('Type').selectOption('cash')
  await dialog.getByLabel('Opening balance').fill('12.345')
  await dialog.getByRole('button', { name: 'Add Account' }).click()
  await expect(dialog.getByRole('alert')).toContainText('opening balance')
  await dialog.getByLabel('Opening balance').fill('50')
  await dialog.getByRole('button', { name: 'Add Account' }).click()
  await expect(dialog).toBeHidden()
  // The new account opens.
  await expect(home.getByRole('heading', { name: 'Fake Wallet' })).toBeVisible()
  await expect(accountButton(home, 'Fake Wallet')).toContainText('$50.00')

  await home.getByRole('button', { name: 'Edit Account…' }).click()
  const edit = home.getByRole('dialog', { name: 'Edit Account' })
  await edit.getByLabel('Name').fill('everyday')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(edit.getByRole('alert')).toHaveText(
    'An account with this name already exists.',
  )
  await edit.getByLabel('Name').fill('Fake Purse')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(home.getByRole('heading', { name: 'Fake Purse' })).toBeVisible()

  await home.getByRole('button', { name: 'Edit Account…' }).click()
  await home.getByRole('button', { name: 'Delete Account…' }).click()
  const confirm = home.getByRole('alertdialog', { name: 'Delete account?' })
  await expect(confirm).toContainText('“Fake Purse” will be deleted.')
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(accountButton(home, 'Fake Purse')).toHaveCount(0)
  await expect(
    home.getByRole('heading', { name: 'All Transactions' }),
  ).toBeVisible()
})

test('an account with transactions is not deleted, and keeps its currency', async ({
  home,
  ledger,
}) => {
  const used = ledger.transactions.filter((row) => row.account === 'Everyday')
  await accountButton(home, 'Everyday').click()
  await home.getByRole('button', { name: 'Edit Account…' }).click()
  await expect(home.getByLabel('Currency')).toBeDisabled()
  await home.getByRole('button', { name: 'Delete Account…' }).click()
  const notice = home.getByRole('alertdialog', { name: 'Account in use' })
  await expect(notice).toContainText(
    `“Everyday” has ${used.length.toLocaleString('en-AU')} transactions.`,
  )
  await notice.getByRole('button', { name: 'OK' }).click()
  await home.getByRole('button', { name: 'Cancel' }).click()
  await expect(accountButton(home, 'Everyday')).toBeVisible()
})

test('categories nest two levels, and a deleted one takes its subcategories', async ({
  home,
  ledger,
}) => {
  await sidebar(home).getByRole('button', { name: 'Settings' }).click()
  const categories = home.getByRole('region', { name: 'Categories' })

  await home.getByRole('button', { name: 'Add Category…' }).click()
  const dialog = home.getByRole('dialog', { name: 'New Category' })
  await dialog.getByLabel('Name').fill('Fake Pets')
  await dialog.getByRole('button', { name: 'Add Category' }).click()
  await home.getByRole('button', { name: 'Add Category…' }).click()
  await dialog.getByLabel('Name').fill('Fake Vet')
  await dialog.getByLabel('Parent').selectOption({ label: 'Fake Pets' })
  // Only top-level categories can take subcategories.
  await expect(
    dialog.getByLabel('Parent').locator('option', { hasText: 'Groceries' }),
  ).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Add Category' }).click()
  await expect(
    categories.locator('li.child', { hasText: 'Fake Vet' }),
  ).toBeVisible()

  // A category with subcategories stays at the top.
  await categories.getByRole('button', { name: /^Food/ }).click()
  const food = home.getByRole('dialog', { name: 'Edit Category' })
  await expect(food.getByLabel('Parent')).toBeDisabled()
  await food.getByRole('button', { name: 'Delete Category…' }).click()
  const affected = ledger.transactions.filter((row) =>
    row.category?.startsWith('Food'),
  ).length
  await expect(
    home.getByRole('alertdialog', { name: 'Delete category?' }),
  ).toHaveText(
    new RegExp(
      `“Food” and its 3 subcategories will be deleted\\. ${affected.toLocaleString('en-AU')} transactions will become uncategorized\\.`,
    ),
  )
  await home.getByRole('button', { name: 'Delete' }).click()
  for (const name of ['Food', 'Groceries', 'Dining Out', 'Coffee']) {
    await expect(
      categories.getByRole('button', { name: new RegExp(`^${name}`) }),
    ).toHaveCount(0)
  }
})
