// What the page says when a call to the main process fails.
import { resolve } from 'node:path'
import {
  chooseFile,
  expect,
  failNext,
  failOnNextPage,
  ledgerTest,
  lockScreen,
  sidebar,
  test,
} from './fixtures'

const RELOAD_FAILED =
  'The ledger could not be reloaded. Some figures may be out of date.'

ledgerTest(
  'an import whose reload fails still reports the import',
  async ({ app, home }) => {
    await chooseFile(app, resolve(__dirname, '../fixtures/csv/westpac.csv'))
    await sidebar(home)
      .getByRole('button', { name: /^Everyday/ })
      .click()
    await home.getByRole('button', { name: 'Import CSV…' }).click()
    await home
      .getByRole('group', { name: 'Accounts' })
      .getByRole('combobox')
      .first()
      .selectOption({ label: 'Everyday' })
    await failNext(app, 'accounts:list')
    await home.getByRole('button', { name: 'Import 2 Transactions' }).click()

    await expect(home.getByRole('heading', { name: 'Everyday' })).toBeVisible()
    await expect(home.getByText('Imported 2 transactions.')).toBeVisible()
    await expect(
      home.getByRole('region', { name: 'Reload notice' }),
    ).toContainText(RELOAD_FAILED)
  },
)

ledgerTest(
  'a category saved while the reload fails closes its dialog',
  async ({ app, home }) => {
    await sidebar(home).getByRole('button', { name: 'Settings' }).click()
    await home.getByRole('button', { name: 'Add Category…' }).click()
    const dialog = home.getByRole('dialog', { name: 'New Category' })
    await dialog.getByLabel('Name').fill('Fake Pets')
    await failNext(app, 'categories:list')
    await dialog.getByRole('button', { name: 'Add Category' }).click()

    await expect(dialog).toBeHidden()
    await expect(
      home.getByRole('region', { name: 'Reload notice' }),
    ).toContainText(RELOAD_FAILED)
  },
)

test('a page that cannot read the vault state says so', async ({ app }) => {
  await failOnNextPage(app, 'vault:status')
  const next = await lockScreen(app)
  await expect(
    next.getByText(
      'The vault could not be read. Quit Local Ledger and open it again.',
    ),
  ).toBeVisible()
})
