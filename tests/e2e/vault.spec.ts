import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
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

      const lockedPid = await rendererPid(again)
      await page.getByLabel('Master password').fill(PASSWORD)
      const home = await replacedBy(again, () =>
        page.getByRole('button', { name: 'Unlock' }).click(),
      )
      await expect(home.getByRole('button', { name: 'Lock' })).toBeVisible()
      await expectExited(lockedPid)
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

  test('closing the window ends its page process and locks the vault', async ({
    app,
  }) => {
    const unlockedPid = await rendererPid(app)
    await app.evaluate(({ app, BaseWindow }) => {
      // As on macOS, where the app keeps running without a window.
      app.removeAllListeners('window-all-closed')
      BaseWindow.getAllWindows()[0]?.close()
    })
    await expectExited(unlockedPid)
    const reopened = await replacedBy(app, () =>
      app.evaluate(({ app }) => {
        app.emit('activate')
      }),
    )
    expect(await reopened.evaluate(() => window.ledger.vault.status())).toBe(
      'locked',
    )
  })

  test('a lock while an unlock derives its key keeps the vault locked', async ({
    app,
  }) => {
    const home = app.windows().at(-1)
    if (!home) throw new Error('no page')
    const locked = await replacedBy(app, () =>
      home.getByRole('button', { name: 'Lock' }).click(),
    )
    await locked.getByLabel('Master password').fill(PASSWORD)
    const unlockingPid = await rendererPid(app)
    const replaced = replacedBy(app, async () => {
      await locked.getByRole('button', { name: 'Unlock' }).click()
      // The key derivation takes a few hundred milliseconds.
      await new Promise((resolve) => setTimeout(resolve, 50))
      await app.evaluate(({ powerMonitor }) => {
        powerMonitor.emit('lock-screen')
      })
    })
    // The page that took the password is replaced by a locked one.
    const relocked = await replaced
    await expectExited(unlockingPid)
    await expect(relocked.getByLabel('Master password')).toBeVisible()
    // Queued behind the cancelled unlock, so this returns once it has ended.
    expect(
      await relocked.evaluate(() =>
        window.ledger.vault.unlock('not the fake passphrase'),
      ),
    ).toEqual({ ok: false, reason: 'wrong-password' })
    expect(await relocked.evaluate(() => window.ledger.vault.status())).toBe(
      'locked',
    )
  })

  test('a lock clears a password typed but not submitted', async ({ app }) => {
    const home = app.windows().at(-1)
    if (!home) throw new Error('no page')
    const locked = await replacedBy(app, () =>
      home.getByRole('button', { name: 'Lock' }).click(),
    )
    await locked.getByLabel('Master password').fill(PASSWORD)
    const typedPid = await rendererPid(app)
    const cleared = await replacedBy(app, () =>
      app.evaluate(({ powerMonitor }) => {
        powerMonitor.emit('lock-screen')
      }),
    )
    await expectExited(typedPid)
    await expect(cleared.getByLabel('Master password')).toHaveValue('')
  })

  // Menu accelerators are not delivered under Xvfb, so this clicks the item;
  // a unit test checks its accelerator.
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

test.describe('automatic lock', () => {
  test.beforeEach(async ({ app, page }) => {
    await createVault(app, page)
  })

  for (const event of ['lock-screen', 'suspend']) {
    test(`locks when the system emits ${event}`, async ({ app }) => {
      const locked = await replacedBy(app, () =>
        app.evaluate(({ powerMonitor }, name) => {
          powerMonitor.emit(name)
        }, event),
      )
      expect(await locked.evaluate(() => window.ledger.vault.status())).toBe(
        'locked',
      )
    })
  }

  test('locks after five minutes of system idle time', async ({ app }) => {
    const locked = await replacedBy(app, () =>
      app.evaluate(({ powerMonitor }) => {
        // The real check reads this on each poll.
        powerMonitor.getSystemIdleTime = () => 5 * 60
      }),
    )
    expect(await locked.evaluate(() => window.ledger.vault.status())).toBe(
      'locked',
    )
  })
})

test('a password change that fails says so, and the old password still works', async ({
  app,
  page,
  userData,
}) => {
  // A read-only vault directory makes the copy fail; Windows has no such mode.
  test.skip(process.platform === 'win32')
  const NEW = 'a new fake passphrase for tests'
  const home = await createVault(app, page)
  await home.getByRole('button', { name: 'Change Password…' }).click()
  await home.getByLabel('Current password').fill(PASSWORD)
  await home.getByLabel('New password', { exact: true }).fill(NEW)
  await home.getByLabel('Confirm new password').fill(NEW)
  chmodSync(vaultDir(userData), 0o500)
  try {
    await home.getByRole('button', { name: 'Change Password' }).click()
    await expect(home.getByRole('alert')).toHaveText(
      'The password could not be changed.',
    )
  } finally {
    chmodSync(vaultDir(userData), 0o700)
  }
  await home.getByRole('button', { name: 'Cancel' }).click()
  const locked = await replacedBy(app, () =>
    home.getByRole('button', { name: 'Lock' }).click(),
  )
  expect(
    await locked.evaluate((next) => window.ledger.vault.unlock(next), NEW),
  ).toEqual({ ok: false, reason: 'wrong-password' })
  await locked.getByLabel('Master password').fill(PASSWORD)
  const unlocked = await replacedBy(app, () =>
    locked.getByRole('button', { name: 'Unlock' }).click(),
  )
  expect(await unlocked.evaluate(() => window.ledger.vault.status())).toBe(
    'unlocked',
  )
})

test('changing the password re-keys the vault in a new page process', async ({
  app,
  page,
  userData,
}) => {
  const NEW = 'a new fake passphrase for tests'
  const home = await createVault(app, page)
  await home.getByRole('button', { name: 'Change Password…' }).click()
  await home.getByLabel('Current password').fill('not the fake passphrase')
  await home.getByLabel('New password', { exact: true }).fill(NEW)
  await home.getByLabel('Confirm new password').fill(NEW)
  await home.getByRole('button', { name: 'Change Password' }).click()
  await expect(home.getByRole('alert')).toHaveText('Wrong password.')

  const changingPid = await rendererPid(app)
  await home.getByLabel('Current password').fill(PASSWORD)
  const changed = await replacedBy(app, () =>
    home.getByRole('button', { name: 'Change Password' }).click(),
  )
  await expectExited(changingPid)
  expect(readdirSync(vaultDir(userData)).sort()).toEqual([
    'ledger-2.db',
    'vault.json',
  ])

  const locked = await replacedBy(app, () =>
    changed.getByRole('button', { name: 'Lock' }).click(),
  )
  expect(
    await locked.evaluate((old) => window.ledger.vault.unlock(old), PASSWORD),
  ).toEqual({ ok: false, reason: 'wrong-password' })
  await locked.getByLabel('Master password').fill(NEW)
  const unlocked = await replacedBy(app, () =>
    locked.getByRole('button', { name: 'Unlock' }).click(),
  )
  expect(await unlocked.evaluate(() => window.ledger.vault.status())).toBe(
    'unlocked',
  )
})
