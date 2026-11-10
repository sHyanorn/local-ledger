// What the page says when a call to the main process fails.
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deriveHere } from '../../src/main/vault/kdf'
import { Vault } from '../../src/main/vault/vault'
import { FAST } from '../support/vault'
import {
  chooseFile,
  createVault,
  expect,
  failNext,
  failOnNextPage,
  ledgerTest,
  lockScreen,
  PASSWORD,
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

test('a wrong password, then a new password too short, shows only the second', async ({
  app,
  page,
}) => {
  const home = await createVault(app, page)
  await home.getByRole('button', { name: 'Settings' }).click()
  await home.getByRole('button', { name: 'Change Master Password…' }).click()
  const alert = home.getByRole('alert')
  const change = async (current: string, next: string) => {
    await home.getByLabel('Current password').fill(current)
    await home.getByLabel('New password', { exact: true }).fill(next)
    await home.getByLabel('Confirm new password').fill(next)
    await home.getByRole('button', { name: 'Change Password' }).click()
  }
  await change('not the fake passphrase', 'a new fake passphrase for tests')
  await expect(alert).toHaveText('Wrong password.')
  await change(PASSWORD, 'too short')
  await expect(alert).toHaveText(/^Use at least \d+ characters\.$/)
})

test('unlocking a vault that has gone says so', async ({
  app,
  page,
  userData,
}) => {
  await createVault(app, page)
  const locked = await lockScreen(app)
  const unlockButton = locked.getByRole('button', { name: 'Unlock' })
  await expect(unlockButton).toBeVisible()
  rmSync(join(userData, 'vault'), { recursive: true })
  await locked.getByLabel('Master password').fill(PASSWORD)
  await unlockButton.click()
  await expect(locked.getByRole('alert')).toHaveText(
    'There is no vault to unlock.',
  )
})

test('creating a vault where one has appeared says so', async ({
  page,
  userData,
}) => {
  const createButton = page.getByRole('button', { name: 'Create Vault' })
  await expect(createButton).toBeVisible()
  const other = new Vault(userData, { derive: deriveHere, kdf: FAST })
  expect(await other.create(PASSWORD)).toEqual({ ok: true })
  other.lock()
  await page.getByLabel('Master password').fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
  await createButton.click()
  await expect(page.getByRole('alert')).toHaveText(
    'A vault already exists here.',
  )
})
