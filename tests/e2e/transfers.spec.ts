import type { Page } from '@playwright/test'
import { expect, ledgerTest, sidebar } from './fixtures'

const list = (page: Page) => page.getByRole('table', { name: 'Transactions' })

ledgerTest(
  'seeded transfers show as transfers, and can be split',
  async ({ home }) => {
    await sidebar(home)
      .getByRole('button', { name: /^Everyday/ })
      .click()
    await home
      .getByRole('searchbox', { name: 'Search' })
      .fill('Transfer to Savings')
    const row = list(home)
      .getByRole('row')
      .filter({ hasText: 'Transfer to Savings' })
      .first()
    const cell = row.getByRole('button', { name: /^Transfer · Savings: / })
    await expect(cell).toHaveText('Transfer · Savings')

    await cell.click()
    const dialog = home.getByRole('dialog', { name: 'Edit Transaction' })
    await expect(dialog).toContainText('Transfer with Savings')
    await dialog.getByRole('button', { name: 'Not a Transfer' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(row.getByRole('button', { name: /^Category of/ })).toHaveText(
      'Uncategorized',
    )

    // Split pairs are not offered again; pairing by hand still works.
    await row.getByRole('cell').nth(1).getByRole('button').click()
    await dialog.getByRole('button', { name: 'Pair as Transfer…' }).click()
    await dialog.getByRole('button', { name: 'Pair', exact: true }).click()
    await expect(
      row.getByRole('button', { name: /^Transfer · Savings: / }),
    ).toBeVisible()
  },
)

ledgerTest(
  'a pair with another candidate waits in Transfers',
  async ({ home }) => {
    // A second deposit of the same amount makes the next transfer ambiguous.
    await home.evaluate(async () => {
      const { accounts, transactions } = window.ledger
      const all = await accounts.list()
      const id = (name: string) =>
        all.find((account) => account.name === name)!.id
      const base = { categoryId: null, notes: '' }
      await transactions.create({
        ...base,
        accountId: id('Everyday'),
        date: '2026-11-07',
        amountCents: -4321,
        description: 'Fake Move Out',
      })
      await transactions.create({
        ...base,
        accountId: id('Savings'),
        date: '2026-11-07',
        amountCents: 4321,
        description: 'Fake Move In',
      })
      await transactions.create({
        ...base,
        accountId: id('Credit Card'),
        date: '2026-11-08',
        amountCents: 4321,
        description: 'Fake Card Credit',
      })
    })
    const transfers = sidebar(home).getByRole('button', { name: /^Transfers/ })
    await transfers.click()
    const pairs = home
      .getByRole('list', { name: 'Possible transfers' })
      .getByRole('listitem')
    await expect(pairs).toHaveCount(2)
    await pairs
      .filter({ hasText: 'Fake Card Credit' })
      .getByRole('button', { name: /^Not a transfer:/ })
      .click()
    await expect(pairs).toHaveCount(1)
    await expect(transfers.getByLabel('1 to review')).toBeVisible()
    await pairs.getByRole('button', { name: /^Pair Fake Move Out/ }).click()
    await expect(home.getByText('No transfers to review')).toBeVisible()
    await expect(transfers.getByLabel(/to review/)).toHaveCount(0)
  },
)
