import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, ledgerTest } from '../e2e/fixtures'

const OUT = resolve(__dirname, '../../docs/screenshots')
const SIZE = { width: 1100, height: 720 }

const PAGES: [string, string | RegExp][] = [
  ['overview', 'Overview'],
  ['transactions', 'All Transactions'],
  ['budgets', /^Budgets/],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
]

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Ledger' })

/** A few budgets, so the Budgets page and Overview show progress. */
async function setBudgets(page: Page) {
  await page.evaluate(async () => {
    const categories = await window.ledger.categories.list()
    const today = new Date()
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const amounts: Record<string, number> = {
      Groceries: 90_000,
      'Dining Out': 15_000,
      Coffee: 2_500,
      Entertainment: 20_000,
    }
    for (const category of categories) {
      const cents = amounts[category.name]
      if (cents) await window.ledger.budgets.set(category.id, month, cents)
    }
  })
}

ledgerTest('README screenshots', async ({ home }) => {
  mkdirSync(OUT, { recursive: true })
  await home.setViewportSize(SIZE)
  await setBudgets(home)
  for (const scheme of ['light', 'dark'] as const) {
    await home.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    for (const [name, label] of PAGES) {
      await sidebar(home).getByRole('button', { name: label }).click()
      await home.waitForTimeout(300)
      await home.screenshot({ path: join(OUT, `${name}-${scheme}.png`) })
    }
  }
})

/** Shows a file to the open dialog. */
function chooseFile(app: ElectronApplication, path: string) {
  return app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog
  }, path)
}

ledgerTest(
  'README GIF: import a bank file and see the month',
  async ({ app, home }) => {
    const frames = mkdtempSync(join(tmpdir(), 'ledger-gif-'))
    let frame = 0
    const shoot = async (repeat = 1) => {
      await home.waitForTimeout(300)
      for (let n = 0; n < repeat; n++) {
        await home.screenshot({
          path: join(frames, `${String(frame++).padStart(3, '0')}.png`),
        })
      }
    }
    try {
      await home.setViewportSize(SIZE)
      await home.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
      await sidebar(home).getByRole('button', { name: 'Everyday' }).click()
      await shoot(2)
      await chooseFile(app, resolve(__dirname, '../fixtures/csv/commbank.csv'))
      await home.getByRole('button', { name: 'Import CSV…' }).click()
      await expect(home.getByText('CommBank format')).toBeVisible()
      await shoot(3)
      await home
        .getByRole('button', { name: /^Import \d+ Transaction/ })
        .click()
      await expect(
        home.getByRole('heading', { name: 'Everyday' }),
      ).toBeVisible()
      await shoot(2)
      await sidebar(home).getByRole('button', { name: 'Reports' }).click()
      await shoot(3)
      await sidebar(home).getByRole('button', { name: 'Overview' }).click()
      await shoot(2)
      // One frame a second, in a shared palette so the GIF stays small.
      execFileSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-framerate',
        '1',
        '-i',
        join(frames, '%03d.png'),
        '-vf',
        'scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=none',
        join(OUT, 'import.gif'),
      ])
    } finally {
      rmSync(frames, { recursive: true, force: true })
    }
  },
)
