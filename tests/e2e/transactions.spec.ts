import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { SeedLedger } from '../../scripts/seed/generate'
import { isoDate } from '../../src/shared/dates'
import { formatAmount } from '../../src/shared/money'
import {
  expect,
  expectExited,
  ledgerTest as test,
  rendererPid,
  replacedBy,
} from './fixtures'

const table = (page: Page) => page.getByRole('table', { name: 'Transactions' })
const rows = (page: Page) => table(page).getByRole('rowgroup').getByRole('row')
const totals = (page: Page) => page.locator('.totals')
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Ledger' })
const n = (count: number) => count.toLocaleString('en-AU')

/** The seeded total of a set of rows, in one currency. */
const sum = (ledger: SeedLedger['transactions']) =>
  ledger.reduce((total, row) => total + row.amountCents, 0)

test('the newest come first, with totals kept apart by currency', async ({
  home,
  ledger,
}) => {
  const newest = ledger.transactions.at(-1)
  if (!newest) throw new Error('no transactions')
  await expect(rows(home).first()).toContainText(newest.description)
  const aud = ledger.transactions.filter((row) => row.account !== 'Travel Cash')
  await expect(totals(home)).toContainText(
    `${n(ledger.transactions.length)} transactions · ${formatAmount(sum(aud), 'AUD')} · `,
  )
})

test('scrolling to the end loads the next page', async ({ home, ledger }) => {
  await expect(rows(home)).toHaveCount(200)
  await table(home)
    .locator('.rows')
    .evaluate((list) => {
      list.scrollTop = list.scrollHeight
    })
  await expect(rows(home)).toHaveCount(400)
  expect(ledger.transactions.length).toBeGreaterThan(400)
})

test('search, category, account and period narrow the list', async ({
  home,
  ledger,
}) => {
  const all = ledger.transactions
  await home.getByRole('searchbox', { name: 'Search' }).fill('COFFEE')
  const coffee = all.filter((row) =>
    `${row.description} ${row.notes}`.toLowerCase().includes('coffee'),
  )
  await expect(totals(home)).toContainText(`${n(coffee.length)} transactions`)
  await home.getByRole('searchbox', { name: 'Search' }).fill('')

  await home.getByLabel('Category', { exact: true }).selectOption('none')
  const uncategorized = all.filter((row) => row.category === null)
  await expect(totals(home)).toContainText(
    `${n(uncategorized.length)} transactions`,
  )
  await home
    .getByLabel('Category', { exact: true })
    .selectOption({ label: 'Food' })
  const food = all.filter((row) => row.category?.startsWith('Food'))
  await expect(totals(home)).toContainText(`${n(food.length)} transactions`)
  await home.getByLabel('Category', { exact: true }).selectOption('')

  await sidebar(home)
    .getByRole('button', { name: /^Travel Cash/ })
    .click()
  const travel = all.filter((row) => row.account === 'Travel Cash')
  await expect(totals(home)).toContainText(`${n(travel.length)} transactions`)
  // Only yuan: the account's own currency.
  await expect(totals(home)).not.toContainText('$')

  await sidebar(home).getByRole('button', { name: 'All Transactions' }).click()
  await home.getByLabel('Period').selectOption('this-month')
  const month = isoDate(new Date()).slice(0, 7)
  const thisMonth = all.filter((row) => row.date.startsWith(month))
  await expect(totals(home)).toContainText(
    `${n(thisMonth.length)} transactions`,
  )
  await home.getByLabel('Period').selectOption('custom')
  await home.getByLabel('From', { exact: true }).fill('1990-01-01')
  await home.getByLabel('To', { exact: true }).fill('1990-12-31')
  await expect(home.getByText('No matching transactions')).toBeVisible()
})

test('a transaction is added, edited, recategorized in place and deleted', async ({
  home,
}) => {
  const balance = sidebar(home)
    .getByRole('button', { name: /^Everyday/ })
    .locator('.amount')
  const before = await balance.textContent()

  await sidebar(home)
    .getByRole('button', { name: /^Everyday/ })
    .click()
  await home.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = home.getByRole('dialog', { name: 'New Transaction' })
  await dialog.getByLabel('Description').fill('Fake Market Stall')
  await dialog.getByLabel('Amount').fill('-3')
  await dialog.getByRole('button', { name: 'Add Transaction' }).click()
  await expect(dialog.getByRole('alert')).toContainText('positive number')
  await dialog.getByLabel('Amount').fill('12.50')
  await dialog
    .getByLabel('Category')
    .selectOption({ label: 'Food › Groceries' })
  await dialog.getByRole('button', { name: 'Add Transaction' }).click()
  await expect(dialog).toBeHidden()
  const added = rows(home).filter({ hasText: 'Fake Market Stall' })
  await expect(added).toContainText('-$12.50')
  await expect(balance).not.toHaveText(before ?? '')

  await added
    .getByRole('button', { name: 'Fake Market Stall', exact: true })
    .click()
  const edit = home.getByRole('dialog', { name: 'Edit Transaction' })
  await edit.getByText('Money in').click()
  await edit.getByLabel('Amount').fill('13.75')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(added).toContainText('$13.75')
  await expect(added.locator('.amount')).toHaveClass(/positive/)

  await added
    .getByRole('button', { name: /^Category of Fake Market Stall/ })
    .click()
  await added
    .getByRole('combobox', { name: 'Category of Fake Market Stall' })
    .selectOption('')
  // Saved: it survives a reload of the list.
  await sidebar(home).getByRole('button', { name: 'All Transactions' }).click()
  await sidebar(home)
    .getByRole('button', { name: /^Everyday/ })
    .click()
  await expect(
    added.getByRole('button', { name: /^Category of Fake Market Stall/ }),
  ).toHaveText('Uncategorized')

  await added
    .getByRole('button', { name: 'Fake Market Stall', exact: true })
    .click()
  await home.getByRole('button', { name: 'Delete…' }).click()
  const confirm = home.getByRole('dialog', { name: 'Delete transaction?' })
  await expect(confirm).toContainText('“Fake Market Stall” on')
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(added).toHaveCount(0)
  await expect(balance).toHaveText(before ?? '')
})

test('after a lock, no transaction text stays in a page or reachable in the main process', async ({
  app,
  home,
}, testInfo) => {
  const marker = `Residue ${randomUUID()}`
  await home.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = home.getByRole('dialog', { name: 'New Transaction' })
  await dialog.getByLabel('Description').fill(marker)
  await dialog.getByLabel('Amount').fill('1')
  await dialog.getByRole('button', { name: 'Add Transaction' }).click()
  await expect(rows(home).first()).toContainText(marker)

  const shown = await rendererPid(app)
  const locked = await replacedBy(app, () =>
    sidebar(home).getByRole('button', { name: 'Lock' }).click(),
  )
  await expectExited(shown)
  await expect(locked.getByLabel('Master password')).toBeVisible()
  expect(await locked.content()).not.toContain(marker)

  // A heap snapshot collects garbage first, so it holds only what is still
  // reachable. A string planted in the main process proves the search works.
  const file = testInfo.outputPath('main.heapsnapshot')
  const control = `Control ${randomUUID()}`
  await app.evaluate(
    (_electron, [path, value]) => {
      Object.assign(globalThis, { residueControl: value })
      process.getBuiltinModule('v8').writeHeapSnapshot(path)
    },
    [file, control] as const,
  )
  // Booleans, so a failure does not print a snapshot of many megabytes.
  const snapshot = readFileSync(file, 'utf8')
  expect(snapshot.includes(control), 'the control is found').toBe(true)
  expect(snapshot.includes(marker), 'the transaction is reachable').toBe(false)
})
