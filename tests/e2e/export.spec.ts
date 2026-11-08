import { existsSync, readFileSync, statSync } from 'node:fs'
import type { ElectronApplication } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { expect, ledgerTest } from './fixtures'

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

ledgerTest(
  'a lock while the save dialog is open writes nothing',
  async ({ app, home }, testInfo) => {
    const path = testInfo.outputPath('locked.pdf')
    await saveTo(app, path, true)
    const result = await home
      .evaluate(
        (month) => window.ledger.export.save(month, 'AUD', 'pdf'),
        thisMonth(),
      )
      .catch((error: Error) => error.message)
    // The page is replaced on lock, so the call may not answer at all.
    if (typeof result === 'string')
      expect(result).toMatch(/locked|closed|destroyed/i)
    expect(existsSync(path)).toBe(false)
  },
)
