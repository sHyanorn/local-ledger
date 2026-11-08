import { readdirSync, readFileSync, statSync } from 'node:fs'
import type { ElectronApplication, Page } from '@playwright/test'
import { DEMO_PASSWORD } from '../../scripts/seed/demo'
import { expect, launch, ledgerTest, replacedBy } from './fixtures'

function saveTo(app: ElectronApplication, path: string | null) {
  return app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: path === null,
      filePath: path ?? '',
    })) as typeof dialog.showSaveDialog
  }, path)
}

const openBackup = async (page: Page) => {
  await page
    .getByRole('navigation', { name: 'Ledger' })
    .getByRole('button', { name: 'Settings' })
    .click()
  await page.getByRole('button', { name: 'Back Up…' }).click()
  return page.getByRole('dialog', { name: 'Back Up Vault' })
}

ledgerTest(
  'a backup needs the master password and is saved where the user picks',
  async ({ app, home }, testInfo) => {
    const path = testInfo.outputPath('vault.llbackup')
    await saveTo(app, path)
    const dialog = await openBackup(home)
    await dialog.getByLabel('Master password').fill('not the fake passphrase')
    await dialog.getByRole('button', { name: 'Back Up…' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Wrong password.')
    await expect(dialog.getByLabel('Master password')).toHaveValue('')

    await dialog.getByLabel('Master password').fill(DEMO_PASSWORD)
    await dialog.getByRole('button', { name: 'Back Up…' }).click()
    await expect(dialog).toBeHidden()
    await expect(home.getByRole('status')).toHaveText('Backup saved.')
    const file = readFileSync(path)
    expect(file.subarray(0, 8).toString()).toBe('LLBACKUP')
    // Encrypted: no account names in it.
    expect(file.includes(Buffer.from('Everyday'))).toBe(false)
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  },
)

function chooseBackup(app: ElectronApplication, path: string) {
  return app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog
  }, path)
}

/** A backup of the seeded vault, saved at path. */
async function makeBackup(app: ElectronApplication, page: Page, path: string) {
  await saveTo(app, path)
  expect(
    await page.evaluate(
      (password) => window.ledger.backup.save(password),
      DEMO_PASSWORD,
    ),
  ).toEqual({ ok: true })
}

ledgerTest(
  'restoring from Settings replaces the data, keeps the current password, and moves the old vault aside',
  async ({ app, home, userData }, testInfo) => {
    const path = testInfo.outputPath('restore.llbackup')
    await makeBackup(app, home, path)
    const added = await home.evaluate(async () => {
      const [first] = await window.ledger.accounts.list()
      const result = await window.ledger.transactions.create({
        accountId: first!.id,
        date: '2026-01-15',
        amountCents: -1234,
        description: 'Fake After Backup',
        categoryId: null,
        notes: '',
      })
      return result.ok
    })
    expect(added).toBe(true)

    await chooseBackup(app, path)
    await home
      .getByRole('navigation', { name: 'Ledger' })
      .getByRole('button', { name: 'Settings' })
      .click()
    await home.getByRole('button', { name: 'Restore from Backup…' }).click()
    const dialog = home.getByRole('dialog', { name: 'Restore from Backup' })
    await dialog.getByRole('button', { name: 'Choose Backup…' }).click()
    await expect(dialog).toContainText('restore.llbackup')
    await dialog.getByLabel('Backup password').fill('not the fake passphrase')
    await dialog.getByRole('button', { name: 'Open Backup' }).click()
    await expect(dialog.getByRole('alert')).toHaveText(
      'Wrong password for this backup.',
    )
    await dialog.getByLabel('Backup password').fill(DEMO_PASSWORD)
    await dialog.getByRole('button', { name: 'Open Backup' }).click()
    await expect(dialog).toContainText(
      /The backup holds 4 accounts and [\d,]+ transactions/,
    )
    await expect(dialog).toContainText('keeps your current master password')

    await dialog
      .getByLabel('Current master password')
      .fill('wrong fake passphrase')
    await dialog.getByRole('button', { name: 'Restore' }).click()
    await expect(dialog.getByRole('alert')).toHaveText(
      'Wrong current password.',
    )

    await dialog.getByLabel('Current master password').fill(DEMO_PASSWORD)
    const restored = await replacedBy(app, () =>
      dialog.getByRole('button', { name: 'Restore' }).click(),
    )
    await expect(
      restored.getByRole('navigation', { name: 'Ledger' }),
    ).toBeVisible()
    const found = await restored.evaluate(async () => {
      const page = await window.ledger.transactions.page(
        { text: 'Fake After Backup' },
        10,
      )
      return page.rows.length
    })
    expect(found).toBe(0)
    expect(
      readdirSync(userData).filter((name) =>
        name.startsWith('vault-before-restore-'),
      ),
    ).toHaveLength(1)
  },
)

ledgerTest(
  'a lock forgets a backup that was opened for restoring',
  async ({ app, home, userData }, testInfo) => {
    const path = testInfo.outputPath('forgotten.llbackup')
    await makeBackup(app, home, path)
    await chooseBackup(app, path)
    expect(await home.evaluate(() => window.ledger.restore.open())).toEqual({
      ok: true,
      name: 'forgotten.llbackup',
    })
    expect(
      await home.evaluate(
        (password) => window.ledger.restore.check(password),
        DEMO_PASSWORD,
      ),
    ).toMatchObject({ ok: true })
    const staged = () =>
      readdirSync(userData).filter((name) =>
        name.startsWith('vault.restoring-'),
      )
    expect(staged()).toHaveLength(1)
    const locked = await replacedBy(app, () =>
      app.evaluate(({ powerMonitor }) => {
        powerMonitor.emit('lock-screen')
      }),
    )
    // Gone at the lock itself, before any unlock.
    expect(staged()).toEqual([])
    await locked.getByLabel('Master password').fill(DEMO_PASSWORD)
    const again = await replacedBy(app, () =>
      locked.getByRole('button', { name: 'Unlock' }).click(),
    )
    expect(
      await again.evaluate(
        (password) => window.ledger.restore.commit(password),
        DEMO_PASSWORD,
      ),
    ).toEqual({ ok: false, reason: 'not-checked' })
  },
)

ledgerTest(
  'restoring at setup uses the backup password',
  async ({ app, home }, testInfo) => {
    const path = testInfo.outputPath('setup.llbackup')
    await makeBackup(app, home, path)
    const fresh = await launch(testInfo.outputPath('fresh-user-data'))
    try {
      const setup = await fresh.firstWindow()
      await expect(
        setup.getByRole('heading', { name: 'Create a master password' }),
      ).toBeVisible()
      await chooseBackup(fresh, path)
      // A lock at setup, with no vault to lock, still drops a checked backup.
      expect(
        await setup.evaluate(() => window.ledger.restore.open()),
      ).toMatchObject({ ok: true })
      expect(
        await setup.evaluate(
          (password) => window.ledger.restore.check(password),
          DEMO_PASSWORD,
        ),
      ).toMatchObject({ ok: true })
      const afterLock = await replacedBy(fresh, () =>
        fresh.evaluate(({ powerMonitor }) => {
          powerMonitor.emit('lock-screen')
        }),
      )
      expect(
        await afterLock.evaluate(() => window.ledger.restore.commit(null)),
      ).toEqual({ ok: false, reason: 'not-checked' })
      expect(
        readdirSync(testInfo.outputPath('fresh-user-data')).filter((name) =>
          name.startsWith('vault.restoring-'),
        ),
      ).toEqual([])
      await afterLock
        .getByRole('button', { name: 'Restore from Backup…' })
        .click()
      const dialog = afterLock.getByRole('dialog', {
        name: 'Restore from Backup',
      })
      await dialog.getByRole('button', { name: 'Choose Backup…' }).click()
      await dialog.getByLabel('Backup password').fill(DEMO_PASSWORD)
      await dialog.getByRole('button', { name: 'Open Backup' }).click()
      await expect(dialog).toContainText(
        "opens with the backup's master password",
      )
      await expect(dialog.getByLabel('Current master password')).toHaveCount(0)
      const restored = await replacedBy(fresh, () =>
        dialog.getByRole('button', { name: 'Restore' }).click(),
      )
      await expect(
        restored.getByRole('navigation', { name: 'Ledger' }),
      ).toBeVisible()
      const locked = await replacedBy(fresh, () =>
        restored.getByRole('button', { name: 'Lock' }).click(),
      )
      await locked.getByLabel('Master password').fill(DEMO_PASSWORD)
      await replacedBy(fresh, () =>
        locked.getByRole('button', { name: 'Unlock' }).click(),
      )
    } finally {
      await fresh.close()
    }
  },
)
