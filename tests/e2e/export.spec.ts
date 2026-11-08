import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs'
import type { ElectronApplication, Page } from '@playwright/test'
import { DEMO_PASSWORD } from '../../scripts/seed/demo'
import { strFromU8, unzipSync } from 'fflate'
import { expect, ledgerTest, replacedBy } from './fixtures'

/** The save dialog answers with this path, or as cancelled for null. */
function saveTo(app: ElectronApplication, path: string | null, lock = false) {
  return app.evaluate(
    ({ dialog, powerMonitor }, { path, lock }) => {
      dialog.showSaveDialog = (async () => {
        // The vault locks while the dialog is open.
        if (lock) powerMonitor.emit('lock-screen')
        return { canceled: path === null, filePath: path ?? '' }
      }) as typeof dialog.showSaveDialog
    },
    { path, lock },
  )
}

const thisMonth = () => {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

ledgerTest(
  'exports the month as a workbook and a PDF, and writes nothing when cancelled',
  async ({ app, home }, testInfo) => {
    const month = thisMonth()
    const save = (format: 'xlsx' | 'pdf') =>
      home.evaluate(
        ([month, format]) => window.ledger.export.save(month, 'AUD', format),
        [month, format] as const,
      )
    const description = await home.evaluate(async () => {
      const page = await window.ledger.transactions.page({}, 1)
      return page.rows[0]!.description
    })

    await saveTo(app, null)
    expect(await save('xlsx')).toEqual({ ok: false, reason: 'cancelled' })

    const xlsx = testInfo.outputPath('statement.xlsx')
    await saveTo(app, xlsx)
    expect(await save('xlsx')).toEqual({ ok: true })
    const parts = unzipSync(readFileSync(xlsx))
    const transactions = strFromU8(parts['xl/worksheets/sheet2.xml']!)
    expect(transactions).toContain(description)
    expect(strFromU8(parts['xl/workbook.xml']!)).toContain(
      'name="Transactions"',
    )
    if (process.platform !== 'win32') {
      expect(statSync(xlsx).mode & 0o777).toBe(0o600)
      // Saving over a file others can read makes it the user's only.
      chmodSync(xlsx, 0o644)
      expect(await save('xlsx')).toEqual({ ok: true })
      expect(statSync(xlsx).mode & 0o777).toBe(0o600)
    }

    const pdf = testInfo.outputPath('statement.pdf')
    await saveTo(app, pdf)
    expect(await save('pdf')).toEqual({ ok: true })
    const bytes = readFileSync(pdf)
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    // The title is fixed text, never the ledger's.
    expect(bytes.toString('latin1')).toContain(
      '/Title (Local Ledger Statement)',
    )
    expect(bytes.length).toBeGreaterThan(5_000)

    // No print window is left behind.
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(0)
  },
)

/** Unlocks from the locked page and returns the page that replaces it. */
async function unlock(app: ElectronApplication, page: Page): Promise<Page> {
  await page.getByLabel('Master password').fill(DEMO_PASSWORD)
  return replacedBy(app, () =>
    page.getByRole('button', { name: 'Unlock' }).click(),
  )
}

const lock = (app: ElectronApplication) =>
  replacedBy(app, () =>
    app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('lock-screen')
    }),
  )

ledgerTest(
  'a lock and unlock while the save dialog is open writes nothing',
  async ({ app, home }, testInfo) => {
    const path = testInfo.outputPath('lock-unlock.xlsx')
    // The dialog stays open until answered.
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (() =>
        new Promise((resolve) => {
          Object.assign(globalThis, {
            answerDialog: () => resolve({ canceled: false, filePath: path }),
          })
        })) as typeof dialog.showSaveDialog
    }, path)
    void home
      .evaluate(
        (month) => window.ledger.export.save(month, 'AUD', 'xlsx'),
        thisMonth(),
      )
      .catch(() => undefined)
    await expect
      .poll(() => app.evaluate(() => 'answerDialog' in globalThis))
      .toBe(true)
    await unlock(app, await lock(app))
    // The vault is open again, but not the one the export began in.
    await app.evaluate(() => {
      ;(globalThis as unknown as { answerDialog: () => void }).answerDialog()
    })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(existsSync(path)).toBe(false)
  },
)

ledgerTest(
  'a lock while the PDF prints writes nothing, and a later export works',
  async ({ app, home }, testInfo) => {
    const path = testInfo.outputPath('during-print.pdf')
    await saveTo(app, path)
    await app.evaluate(({ app: electron, powerMonitor }) => {
      electron.once('browser-window-created', (_event, window) => {
        const print = window.webContents.printToPDF.bind(window.webContents)
        window.webContents.printToPDF = ((options) => {
          const printing = print(options)
          setImmediate(() => powerMonitor.emit('lock-screen'))
          return printing
        }) as typeof window.webContents.printToPDF
      })
    })
    void home
      .evaluate(
        (month) => window.ledger.export.save(month, 'AUD', 'pdf'),
        thisMonth(),
      )
      .catch(() => undefined)
    // The print window is a window too; the locked page asks for the password.
    let lockedPage: Page | undefined
    await expect
      .poll(async () => {
        for (const page of app.windows()) {
          const asks = await page
            .getByLabel('Master password')
            .isVisible()
            .catch(() => false)
          if (asks) lockedPage = page
        }
        return lockedPage !== undefined
      })
      .toBe(true)
    const again = await unlock(app, lockedPage!)
    expect(existsSync(path)).toBe(false)
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(0)

    const next = testInfo.outputPath('after.xlsx')
    await saveTo(app, next)
    expect(
      await again.evaluate(
        (month) => window.ledger.export.save(month, 'AUD', 'xlsx'),
        thisMonth(),
      ),
    ).toEqual({ ok: true })
    expect(existsSync(next)).toBe(true)
  },
)

ledgerTest(
  'the export dialog says the file is unencrypted before saving',
  async ({ app, home }, testInfo) => {
    const path = testInfo.outputPath('from-dialog.pdf')
    await saveTo(app, path)
    await home
      .getByRole('navigation', { name: 'Ledger' })
      .getByRole('button', { name: 'Reports' })
      .click()
    await home.getByRole('button', { name: 'Export…' }).click()
    const dialog = home.getByRole('alertdialog', { name: /^Export / })
    await expect(dialog).toHaveAccessibleDescription(/not encrypted/)
    await dialog.getByLabel('PDF').check()
    // Printing waits, so the dialog can be seen while it works.
    await app.evaluate(({ app: electron }) => {
      electron.once('browser-window-created', (_event, window) => {
        const print = window.webContents.printToPDF.bind(window.webContents)
        window.webContents.printToPDF = (async (options) => {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          return print(options)
        }) as typeof window.webContents.printToPDF
      })
    })
    await dialog.getByRole('button', { name: 'Export…' }).click()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await home.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(home.getByRole('region', { name: 'Notice' })).toContainText(
      'Exported',
    )
    expect(readFileSync(path).subarray(0, 5).toString('latin1')).toBe('%PDF-')
  },
)

ledgerTest(
  'after exporting and a lock, the exported text is not reachable in the main process',
  async ({ app, home }, testInfo) => {
    const control = `Control ${randomUUID()}`
    await app.evaluate(
      (_electron, value) => {
        Object.assign(globalThis, { residueControl: value })
      },
      `${'-'.repeat(4096)}${control}`,
    )
    const marker = `Residue ${randomUUID()}`
    const month = thisMonth()
    await home.evaluate(
      async ([marker, month]) => {
        const accounts = await window.ledger.accounts.list()
        await window.ledger.transactions.create({
          accountId: accounts.find((account) => account.currency === 'AUD')!.id,
          date: `${month}-01`,
          amountCents: -100,
          description: marker,
          categoryId: null,
          notes: '',
        })
      },
      [marker, month] as const,
    )
    for (const format of ['xlsx', 'pdf'] as const) {
      await saveTo(app, testInfo.outputPath(`residue.${format}`))
      expect(
        await home.evaluate(
          ([month, format]) => window.ledger.export.save(month, 'AUD', format),
          [month, format] as const,
        ),
      ).toEqual({ ok: true })
    }
    await replacedBy(app, () =>
      app.evaluate(({ powerMonitor }) => {
        powerMonitor.emit('lock-screen')
      }),
    )
    const file = testInfo.outputPath('main.heapsnapshot')
    await app.evaluate((_electron, path) => {
      process.getBuiltinModule('v8').writeHeapSnapshot(path)
    }, file)
    const snapshot = readFileSync(file, 'utf8')
    expect(snapshot.includes(control), 'the control is found').toBe(true)
    expect(snapshot.includes(marker), 'the exported text is reachable').toBe(
      false,
    )
  },
)
