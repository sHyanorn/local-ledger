// Exporting a statement. The page asks for a month, a currency and a format;
// the main process asks the user where to save it, builds the file, and
// writes it there. The file is not encrypted (SECURITY_DESIGN). A lock or
// unlock while this runs cancels it, and nothing is written.
import type { BaseWindow, FileFilter } from 'electron'
import chartCss from '../../shared/charts.css?raw'
import type { ExportFormat } from '../../shared/export'
import type { Outcome } from '../../shared/ipc'
import type { Currency } from '../../shared/money'
import { showSave } from '../dialogs'
import type { Handle } from '../ipc'
import { writeFailure, writeOwnerOnly } from '../owner-only'
import { LockedError, signalUntilChange, type Vault } from '../vault/vault'
import { printPdf } from './print'
import reportCss from './report.css?raw'
import { statementPage } from './report-page'
import { statement, statementSheets } from './statement'
import { workbook } from './xlsx'

const FILTERS: Record<ExportFormat, FileFilter> = {
  xlsx: { name: 'Excel Workbook', extensions: ['xlsx'] },
  pdf: { name: 'PDF', extensions: ['pdf'] },
}

export function handleExport(
  vault: Vault,
  window: () => BaseWindow | null,
  handle: Handle,
): void {
  const currentSignal = signalUntilChange(vault)
  let busy = false

  handle('export:save', async ({ month, currency, format }) => {
    vault.database() // Fails when locked, before any dialog opens.
    if (busy) return { ok: false, reason: 'busy' } as const
    busy = true
    try {
      return await save(month, currency, format, currentSignal())
    } finally {
      busy = false
    }
  })

  async function save(
    month: string,
    currency: Currency,
    format: ExportFormat,
    signal: AbortSignal,
  ): Promise<Outcome<'cancelled' | 'unwritable' | 'unwritable-kept'>> {
    const chosen = await showSave(window(), {
      defaultPath: `Statement ${month} ${currency}.${format}`,
      filters: [FILTERS[format]],
    })
    if (chosen.canceled || !chosen.filePath) {
      return { ok: false, reason: 'cancelled' }
    }
    if (signal.aborted) throw new LockedError()
    const data = statement(vault.database(), month, currency)
    let bytes: Uint8Array
    try {
      bytes =
        format === 'xlsx'
          ? workbook(statementSheets(data))
          : await printPdf(
              statementPage(data),
              `${chartCss}\n${reportCss}`,
              signal,
            )
    } catch (error) {
      if (signal.aborted) throw new LockedError()
      throw error
    }
    try {
      if (signal.aborted) throw new LockedError()
      await writeOwnerOnly(chosen.filePath, bytes)
      return { ok: true }
    } catch (error) {
      if (error instanceof LockedError) throw error
      return { ok: false, reason: writeFailure(chosen.filePath) }
    } finally {
      bytes.fill(0)
    }
  }
}
