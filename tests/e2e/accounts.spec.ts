import { resolve } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { formatAmount } from '../../src/shared/money'
import { chooseFile, expect, ledgerTest as test, sidebar } from './fixtures'

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
      expect(shown).not.toContain('$')
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

test('an account that gained transactions since the page loaded is not deleted', async ({
  home,
}) => {
  await sidebar(home).getByRole('button', { name: 'Add Account' }).click()
  const dialog = home.getByRole('dialog', { name: 'New Account' })
  await dialog.getByLabel('Name').fill('Fake Wallet')
  await dialog.getByRole('button', { name: 'Add Account' }).click()
  await expect(home.getByRole('heading', { name: 'Fake Wallet' })).toBeVisible()
  await home.getByRole('button', { name: 'Edit Account…' }).click()
  // A transaction the page has not heard of yet.
  await home.evaluate(async () => {
    const accounts = await window.ledger.accounts.list()
    const wallet = accounts.find((account) => account.name === 'Fake Wallet')!
    await window.ledger.transactions.create({
      accountId: wallet.id,
      date: '2026-05-01',
      amountCents: -500,
      description: 'Fake Kiosk',
      categoryId: null,
      notes: '',
    })
  })
  await home.getByRole('button', { name: 'Delete Account…' }).click()
  const confirm = home.getByRole('alertdialog', { name: 'Delete account?' })
  await confirm.getByRole('button', { name: 'Delete' }).click()
  const edit = home.getByRole('dialog', { name: 'Edit Account' })
  await expect(edit.getByRole('alert')).toHaveText(
    'This account has transactions. Delete or move them before deleting the account.',
  )
  await edit.getByRole('button', { name: 'Cancel' }).click()
  await expect(accountButton(home, 'Fake Wallet')).toBeVisible()
})

test('an archived account leaves the sidebar and the pickers, and every total stays', async ({
  app,
  home,
}) => {
  const nav = sidebar(home)
  const accounts = nav.getByRole('list', { name: 'Accounts' })
  const archived = nav.getByRole('list', { name: 'Archived' })
  const toggle = nav.getByRole('button', { name: 'Archived' })
  const totals = home.locator('.totals')
  const reports = async () => {
    await nav.getByRole('button', { name: 'Reports' }).click()
    const months = home.getByRole('img', {
      name: /^Income and spending by month/,
    })
    await expect(months.locator('rect.bar.income')).toHaveCount(12)
    // The trend loads with a call of its own.
    const trend = home.getByRole('img', { name: /^Spending on / })
    await expect(trend.locator('rect.dot')).toHaveCount(12)
    return home.getByRole('main').innerText()
  }
  const options = (select: Locator) => select.locator('option')

  await expect(totals).not.toBeEmpty()
  const allTotals = await totals.textContent()
  const report = await reports()
  await expect(toggle).toHaveCount(0)

  await accountButton(home, 'Everyday').click()
  await home.getByRole('button', { name: 'Edit Account…' }).click()
  await home
    .getByRole('button', { name: 'Archive Account', exact: true })
    .click()
  await expect(home.getByRole('dialog', { name: 'Edit Account' })).toBeHidden()
  // The page stays, and the account shows under Archived.
  await expect(home.getByRole('heading', { name: 'Everyday' })).toBeVisible()
  await expect(accounts.locator('.name')).toHaveText([
    'Credit Card',
    'Savings',
    'Travel Cash',
  ])
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(archived.locator('.name')).toHaveText(['Everyday'])
  await expect(accountButton(home, 'Everyday')).toHaveAttribute(
    'aria-current',
    'page',
  )

  // A transaction already in it keeps it; a new one cannot go in.
  await home
    .getByRole('table', { name: 'Transactions' })
    .getByRole('row')
    .nth(1)
    .dblclick()
  const edit = home.getByRole('dialog', { name: 'Edit Transaction' })
  await expect(edit.getByLabel('Account').locator('option:checked')).toHaveText(
    'Everyday',
  )
  await expect(options(edit.getByLabel('Account'))).toHaveText([
    'Credit Card',
    'Everyday',
    'Savings',
    'Travel Cash',
  ])
  await edit.getByRole('button', { name: 'Cancel' }).click()
  await home.getByRole('button', { name: 'Add Transaction' }).click()
  const add = home.getByRole('dialog', { name: 'New Transaction' })
  await expect(options(add.getByLabel('Account'))).toHaveText([
    'Credit Card',
    'Savings',
    'Travel Cash',
  ])
  await expect(add.getByLabel('Account').locator('option:checked')).toHaveText(
    'Credit Card',
  )
  await add.getByRole('button', { name: 'Cancel' }).click()

  await chooseFile(app, resolve(__dirname, '../fixtures/csv/commbank.csv'))
  await home.getByRole('button', { name: 'Import CSV…' }).click()
  const target = home.getByRole('combobox', { name: /^Account/ })
  await expect(target).toHaveValue('')
  await expect(options(target)).toHaveText([
    'Choose…',
    'Credit Card',
    'Savings',
    'Travel Cash',
  ])
  await home.getByRole('button', { name: 'Cancel' }).click()

  await toggle.click()
  await expect(archived).toHaveCount(0)
  await nav.getByRole('button', { name: 'All Transactions' }).click()
  await expect(totals).toHaveText(allTotals ?? '')
  expect(await reports()).toBe(report)

  await toggle.click()
  await accountButton(home, 'Everyday').click()
  await home.getByRole('button', { name: 'Edit Account…' }).click()
  await home.getByRole('button', { name: 'Unarchive Account' }).click()
  await expect(accounts.locator('.name')).toHaveText([
    'Credit Card',
    'Everyday',
    'Savings',
    'Travel Cash',
  ])
  await expect(toggle).toHaveCount(0)
})

test('with every account archived, nothing can be added or imported', async ({
  home,
}) => {
  await home.evaluate(async () => {
    for (const account of await window.ledger.accounts.list()) {
      if (account.name !== 'Everyday') {
        await window.ledger.accounts.archive(account.id, true)
      }
    }
  })
  // Archiving the last one from the page reloads the accounts.
  await accountButton(home, 'Everyday').click()
  await home.getByRole('button', { name: 'Edit Account…' }).click()
  await home
    .getByRole('button', { name: 'Archive Account', exact: true })
    .click()
  await expect(
    sidebar(home).getByRole('list', { name: 'Archived' }).locator('.name'),
  ).toHaveText(['Credit Card', 'Everyday', 'Savings', 'Travel Cash'])
  await expect(
    sidebar(home).getByRole('list', { name: 'Accounts' }).getByRole('listitem'),
  ).toHaveCount(0)
  await expect(
    home.getByRole('button', { name: 'Add Transaction' }),
  ).toBeDisabled()
  await expect(home.getByRole('button', { name: 'Import CSV…' })).toBeDisabled()
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
