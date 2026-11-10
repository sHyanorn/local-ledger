import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { DEMO_PASSWORD } from '../../scripts/seed/demo'
import {
  chooseFile,
  expect,
  ledgerTest,
  lockScreen,
  saveTo,
  sidebar,
  test,
} from './fixtures'

// Every screen, in both colour schemes, against the WCAG 2.2 A and AA rules
// axe-core can check by itself (D043).
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

interface Violation {
  id: string
  nodes: { html: string }[]
}

/** The violations on the page as it is now, one line each. */
async function violations(page: Page, screen: string): Promise<string[]> {
  // Transitions between views and into dialogs end first.
  await page.waitForTimeout(400)
  await page.evaluate(AXE)
  const found = await page.evaluate(async (tags) => {
    const { axe } = globalThis as unknown as {
      axe: {
        run(
          context: Document,
          options: unknown,
        ): Promise<{ violations: Violation[] }>
      }
    }
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: tags },
    })
    return result.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ html }) => ({ html })),
    }))
  }, TAGS)
  return found.flatMap(({ id, nodes }) =>
    nodes.map(({ html }) => `${screen}: ${id}: ${html.slice(0, 200)}`),
  )
}

async function setScheme(
  app: ElectronApplication,
  page: Page,
  scheme: 'light' | 'dark',
) {
  await app.evaluate(({ nativeTheme }, source) => {
    nativeTheme.themeSource = source
  }, scheme)
  await page.emulateMedia({ colorScheme: scheme })
}

for (const scheme of ['light', 'dark'] as const) {
  test(`the setup page has no accessibility violations, ${scheme}`, async ({
    app,
    page,
  }) => {
    await setScheme(app, page, scheme)
    expect(await violations(page, 'setup')).toEqual([])
  })

  ledgerTest(
    `no screen of the ledger has accessibility violations, ${scheme}`,
    async ({ app, home }, testInfo) => {
      ledgerTest.setTimeout(120_000)
      await setScheme(app, home, scheme)
      const nav = sidebar(home)
      const found = await violations(home, 'transactions')
      const scan = async (page: Page, screen: string) => {
        found.push(...(await violations(page, screen)))
      }

      for (const view of ['Overview', 'Budgets', 'Reports', 'Transfers']) {
        await nav.getByRole('button', { name: view }).first().click()
        await scan(home, view)
      }

      await nav.getByRole('button', { name: 'Settings' }).click()
      await scan(home, 'Settings')
      await home.getByRole('button', { name: 'Back Up…' }).click()
      await scan(home, 'backup dialog')
      await home.getByRole('button', { name: 'Cancel' }).click()
      await home.getByRole('button', { name: 'Restore from Backup…' }).click()
      await scan(home, 'restore dialog')
      await home.getByRole('button', { name: 'Cancel' }).click()
      await home
        .getByRole('button', { name: 'Change Master Password…' })
        .click()
      await scan(home, 'change password')
      await home.getByRole('button', { name: 'Cancel' }).click()

      await chooseFile(app, resolve(__dirname, '../fixtures/csv/westpac.csv'))
      await nav.getByRole('button', { name: /^Everyday/ }).click()
      await home.getByRole('button', { name: 'Import CSV…' }).click()
      await home
        .getByRole('group', { name: 'Accounts' })
        .getByRole('combobox')
        .first()
        .selectOption({ label: 'Everyday' })
      await expect(home.getByText('2 new transactions')).toBeVisible()
      await scan(home, 'import')
      await home.getByRole('button', { name: 'Import 2 Transactions' }).click()
      await nav.getByRole('button', { name: 'Settings' }).click()
      await scan(home, 'Settings with an import')
      await home.getByRole('button', { name: 'Undo…' }).click()
      await expect(
        home.getByRole('alertdialog', { name: 'Undo Import?' }),
      ).toBeVisible()
      await scan(home, 'undo import')
      await home.getByRole('button', { name: 'Cancel' }).click()

      const backup = testInfo.outputPath('a11y.llbackup')
      await saveTo(app, backup)
      expect(
        await home.evaluate(
          (password) => window.ledger.backup.save(password),
          DEMO_PASSWORD,
        ),
      ).toEqual({ ok: true })
      const locked = await lockScreen(app)
      await locked.emulateMedia({ colorScheme: scheme })
      await scan(locked, 'locked')
      await chooseFile(app, backup)
      await locked.getByRole('button', { name: 'Restore from Backup…' }).click()
      const dialog = locked.getByRole('dialog', { name: 'Restore from Backup' })
      await dialog.getByRole('button', { name: 'Choose Backup…' }).click()
      await dialog.getByLabel('Backup password').fill(DEMO_PASSWORD)
      await scan(locked, 'restore from locked')
      await dialog.getByRole('button', { name: 'Open Backup' }).click()
      await expect(
        dialog.getByRole('button', { name: 'Restore' }),
      ).toBeVisible()
      await scan(locked, 'restore from locked, confirming')

      expect(found).toEqual([])
    },
  )
}
