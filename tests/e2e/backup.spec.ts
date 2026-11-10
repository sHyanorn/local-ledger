import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { DEMO_PASSWORD } from '../../scripts/seed/demo'
import {
  chooseFile,
  expect,
  expectDialogsAsked,
  launch,
  ledgerTest,
  lockScreen,
  replacedBy,
  saveTo,
  sidebar,
  unlock,
} from './fixtures'

const openBackup = async (page: Page) => {
  await sidebar(page).getByRole('button', { name: 'Settings' }).click()
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
  'a backup that cannot be saved leaves the backup already there as it was, and says so',
  async ({ app, home }, testInfo) => {
    const path = testInfo.outputPath('kept.llbackup')
    await makeBackup(app, home, path)
    const first = readFileSync(path)
    await home.evaluate(() =>
      window.ledger.accounts.create({
        name: 'Fake Added Since',
        type: 'bank',
        currency: 'AUD',
        openingBalanceCents: 0,
      }),
    )

    // Something in the way of the temporary file: the save cannot begin.
    mkdirSync(`${path}.tmp`)
    await saveTo(app, path)
    const dialog = await openBackup(home)
    await dialog.getByLabel('Master password').fill(DEMO_PASSWORD)
    await dialog.getByRole('button', { name: 'Back Up…' }).click()
    await expect(dialog.getByRole('alert')).toHaveText(
      'The file could not be saved there. The file already there was not changed.',
    )
    expect(readFileSync(path).equals(first)).toBe(true)

    // With nothing there, the message promises nothing.
    const fresh = testInfo.outputPath('fresh.llbackup')
    mkdirSync(`${fresh}.tmp`)
    await saveTo(app, fresh)
    await dialog.getByLabel('Master password').fill(DEMO_PASSWORD)
    await dialog.getByRole('button', { name: 'Back Up…' }).click()
    await expect(dialog.getByRole('alert')).toHaveText(
      'The file could not be saved there.',
    )

    // Once it can be saved, the new backup replaces the old one whole.
    rmSync(`${path}.tmp`, { recursive: true })
    rmSync(`${fresh}.tmp`, { recursive: true })
    await saveTo(app, path)
    await dialog.getByLabel('Master password').fill(DEMO_PASSWORD)
    await dialog.getByRole('button', { name: 'Back Up…' }).click()
    await expect(dialog).toBeHidden()
    expect(readFileSync(path).equals(first)).toBe(false)
    expect(
      readdirSync(dirname(path)).filter((name) => /llbackup/.test(name)),
    ).toEqual(['kept.llbackup'])
    await chooseFile(app, path)
    expect(await home.evaluate(() => window.ledger.restore.open())).toEqual({
      ok: true,
      name: 'kept.llbackup',
    })
  },
)

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

    await chooseFile(app, path)
    await sidebar(home).getByRole('button', { name: 'Settings' }).click()
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
    await expect(sidebar(restored)).toBeVisible()
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
    await chooseFile(app, path)
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
    const locked = await lockScreen(app)
    // Gone at the lock itself, before any unlock.
    expect(staged()).toEqual([])
    const again = await unlock(app, locked)
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
      await chooseFile(fresh, path)
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
      const afterLock = await lockScreen(fresh)
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
      await expect(sidebar(restored)).toBeVisible()
      const locked = await replacedBy(fresh, () =>
        restored.getByRole('button', { name: 'Lock' }).click(),
      )
      await unlock(fresh, locked)
      await expectDialogsAsked(fresh)
    } finally {
      await fresh.close()
    }
  },
)

ledgerTest(
  'restoring from the locked page moves the vault aside and uses the backup password',
  async ({ app, home, userData }, testInfo) => {
    const path = testInfo.outputPath('locked.llbackup')
    await makeBackup(app, home, path)
    const locked = await lockScreen(app)
    await chooseFile(app, path)
    await locked.getByRole('button', { name: 'Restore from Backup…' }).click()
    const dialog = locked.getByRole('dialog', { name: 'Restore from Backup' })
    await dialog.getByRole('button', { name: 'Choose Backup…' }).click()
    await dialog.getByLabel('Backup password').fill(DEMO_PASSWORD)
    await dialog.getByRole('button', { name: 'Open Backup' }).click()
    await expect(dialog).toContainText(
      'moved to a folder named vault-before-restore beside it, and not deleted',
    )
    await expect(dialog).toContainText(
      "opens with the backup's master password",
    )
    await expect(dialog.getByLabel('Current master password')).toHaveCount(0)
    const restored = await replacedBy(app, () =>
      dialog.getByRole('button', { name: 'Restore' }).click(),
    )
    await expect(sidebar(restored)).toBeVisible()
    const aside = readdirSync(userData).filter((name) =>
      name.startsWith('vault-before-restore-'),
    )
    expect(aside).toHaveLength(1)
    expect(readdirSync(join(userData, aside[0]!)).sort()).toEqual([
      'ledger-1.db',
      'vault.json',
    ])
    await unlock(app, await lockScreen(app))
  },
)
