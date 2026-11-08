import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  createVault,
  expect,
  expectExited,
  launch,
  PASSWORD,
  rendererPid,
  replacedBy,
  test,
} from './fixtures'

const vaultDir = (userData: string) => join(userData, 'vault')

test.describe('setup', () => {
  test('asks for at least 15 characters', async ({ page, userData }) => {
    await page.getByLabel('Master password').fill('fourteen chars')
    await page.getByLabel('Confirm password').fill('fourteen chars')
    await page.getByRole('button', { name: 'Create Vault' }).click()
    await expect(page.getByRole('alert')).toHaveText(
      'Use at least 15 characters.',
    )
    expect(existsSync(vaultDir(userData))).toBe(false)
  })

  test('asks for the password twice', async ({ page, userData }) => {
    await page.getByLabel('Master password').fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(`${PASSWORD}.`)
    await page.getByRole('button', { name: 'Create Vault' }).click()
    await expect(page.getByRole('alert')).toHaveText(
      'The passwords do not match.',
    )
    expect(existsSync(vaultDir(userData))).toBe(false)
  })

  test('says the password cannot be recovered', async ({ page }) => {
    await expect(
      page.getByText(
        'If you forget this password, your data cannot be recovered.',
      ),
    ).toBeVisible()
    await expect(page.getByLabel('Master password')).toHaveAttribute(
      'placeholder',
      'A sentence only you would know',
    )
  })

  test('creates an encrypted vault in a new page process', async ({
    app,
    page,
    userData,
  }) => {
    const setupPid = await rendererPid(app)
    const home = await createVault(app, page)
    await expect(home.getByRole('button', { name: 'Lock' })).toBeVisible()
    expect(page.isClosed()).toBe(true)
    await expectExited(setupPid)

    expect(readdirSync(vaultDir(userData)).sort()).toEqual([
      'ledger-1.db',
      'vault.json',
    ])
    const database = readFileSync(join(vaultDir(userData), 'ledger-1.db'))
    expect(database.subarray(0, 16).toString('latin1')).not.toBe(
      'SQLite format 3\0',
    )
    expect(
      await home.evaluate(() =>
        window.ledger.vault.create('another passphrase here'),
      ),
    ).toEqual({ ok: false, reason: 'exists' })
  })
})

test.describe('unlock and lock', () => {
  test.beforeEach(async ({ app, page }) => {
    await createVault(app, page)
  })

  test('a restart asks for the password and refuses a wrong one', async ({
    app,
    userData,
  }) => {
    await app.close()
    const again = await launch(userData)
    try {
      const page = await again.firstWindow()
      await expect(
        page.getByRole('heading', { name: 'Local Ledger' }),
      ).toBeVisible()
      await page.getByLabel('Master password').fill(`${PASSWORD} with a typo`)
      await page.getByRole('button', { name: 'Unlock' }).click()
      await expect(page.getByRole('alert')).toHaveText('Wrong password.')

      await page.getByLabel('Master password').fill(PASSWORD)
      const home = await replacedBy(again, () =>
        page.getByRole('button', { name: 'Unlock' }).click(),
      )
      await expect(home.getByRole('button', { name: 'Lock' })).toBeVisible()
    } finally {
      await again.close()
    }
  })

  test('locking replaces the page process and closes the vault', async ({
    app,
  }) => {
    const home = app.windows().at(-1)
    if (!home) throw new Error('no page')
    const unlockedPid = await rendererPid(app)
    const locked = await replacedBy(app, () =>
      home.getByRole('button', { name: 'Lock' }).click(),
    )
    await expectExited(unlockedPid)
    await expect(locked.getByLabel('Master password')).toBeVisible()
    expect(await locked.evaluate(() => window.ledger.vault.status())).toBe(
      'locked',
    )
  })

  test('the Lock menu item locks', async ({ app }) => {
    const locked = await replacedBy(app, () =>
      app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()?.getMenuItemById('lock')?.click(),
      ),
    )
    expect(await locked.evaluate(() => window.ledger.vault.status())).toBe(
      'locked',
    )
  })
})

test('a vault whose database is missing is reported, and nothing is deleted', async ({
  app,
  page,
  userData,
}) => {
  await createVault(app, page)
  await app.close()
  rmSync(join(vaultDir(userData), 'ledger-1.db'))

  const again = await launch(userData)
  try {
    const shown = await again.firstWindow()
    await expect(
      shown.getByRole('heading', { name: 'This vault cannot be opened' }),
    ).toBeVisible()
    expect(
      await shown.evaluate(() =>
        window.ledger.vault.unlock('fake ledger passphrase for tests'),
      ),
    ).toEqual({ ok: false, reason: 'damaged' })
    expect(readdirSync(vaultDir(userData))).toEqual(['vault.json'])
  } finally {
    await again.close()
  }
})
