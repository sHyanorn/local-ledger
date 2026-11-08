import { readFileSync, statSync } from 'node:fs'
import type { ElectronApplication, Page } from '@playwright/test'
import { DEMO_PASSWORD } from '../../scripts/seed/demo'
import { expect, ledgerTest } from './fixtures'

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
