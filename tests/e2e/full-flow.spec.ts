import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import {
  chooseFile,
  createVault,
  expect,
  saveTo,
  sidebar,
  test,
} from './fixtures'

/** Months from May 2026, the month of the sample file, to this one. */
const monthsSinceSample = () => {
  const today = new Date()
  return (today.getFullYear() - 2026) * 12 + today.getMonth() - 4
}

test('a new user sets a password, imports, categorizes, budgets and exports', async ({
  app,
  page,
}, testInfo) => {
  const home = await createVault(app, page)

  await sidebar(home).getByRole('button', { name: 'Add Account' }).click()
  const account = home.getByRole('dialog', { name: 'New Account' })
  await account.getByLabel('Name').fill('Fake Everyday')
  await account.getByRole('button', { name: 'Add Account' }).click()
  await expect(account).toBeHidden()

  await sidebar(home).getByRole('button', { name: 'Settings' }).click()
  await home.getByRole('button', { name: 'Add Category…' }).click()
  const category = home.getByRole('dialog', { name: 'New Category' })
  await category.getByLabel('Name').fill('Fake Food')
  await category.getByRole('button', { name: 'Add Category' }).click()
  await expect(category).toBeHidden()

  // Import a bank file through the open dialog.
  const sample = resolve(__dirname, '../fixtures/csv/commbank.csv')
  await chooseFile(app, sample)
  await sidebar(home).getByRole('button', { name: 'Fake Everyday' }).click()
  await home.getByRole('button', { name: 'Import CSV…' }).click()
  await expect(home.getByText('CommBank format')).toBeVisible()
  await home.getByRole('button', { name: /^Import \d+ Transactions$/ }).click()
  await expect(
    home.getByRole('heading', { name: 'Fake Everyday' }),
  ).toBeVisible()

  // Categorize a row in place.
  await home
    .getByRole('button', { name: /^Category of FAKE MARKET STALL/ })
    .click()
  await home
    .getByRole('combobox', { name: /^Category of FAKE MARKET STALL/ })
    .selectOption({ label: 'Fake Food' })
  await expect(
    home.getByRole('button', { name: /^Category of FAKE MARKET STALL/ }),
  ).toContainText('Fake Food')

  // A budget for the sample's month, which the spending goes over.
  await sidebar(home)
    .getByRole('button', { name: /^Budgets/ })
    .click()
  for (let n = 0; n < monthsSinceSample(); n++) {
    await home.getByRole('button', { name: 'Previous Month' }).click()
  }
  await expect(home.getByText('May 2026')).toBeVisible()
  const food = home
    .getByRole('listitem')
    .filter({ has: home.getByText('Fake Food', { exact: true }) })
  await food.getByRole('button', { name: 'Set budget for Fake Food' }).click()
  await food.getByLabel(/^Budget for Fake Food from/).fill('10')
  await food.getByRole('button', { name: 'Save' }).click()
  await expect(food).toContainText(/over \$10\.00/)

  // Export the month as a workbook.
  const path = testInfo.outputPath('statement.xlsx')
  await saveTo(app, path)
  await sidebar(home).getByRole('button', { name: 'Reports' }).click()
  for (let n = 0; n < monthsSinceSample(); n++) {
    await home.getByRole('button', { name: 'Previous Month' }).click()
  }
  await home.getByRole('button', { name: 'Export…' }).click()
  const exporting = home.getByRole('alertdialog', { name: 'Export May 2026' })
  await exporting.getByRole('button', { name: 'Export…' }).click()
  await expect(exporting).toBeHidden()
  const parts = unzipSync(readFileSync(path))
  const sheets = Object.keys(parts)
    .filter((name) => name.startsWith('xl/worksheets/'))
    .sort()
    .map((name) => strFromU8(parts[name]!))
  expect(sheets).toHaveLength(3)
  expect(sheets[1]).toContain('Fake Food')
  expect(sheets[2]).toContain('FAKE MARKET STALL')
})
