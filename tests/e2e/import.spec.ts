import { resolve } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { DEMO_PASSWORD } from '../../scripts/seed/demo'
import { expect, ledgerTest, replacedBy } from './fixtures'

const sample = (name: string) => resolve(__dirname, '../fixtures/csv', name)

/** The open dialog answers with this file, or as cancelled for null. */
function chooseFile(app: ElectronApplication, path: string | null) {
  return app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({
      canceled: chosen === null,
      filePaths: chosen === null ? [] : [chosen],
    })) as typeof dialog.showOpenDialog
  }, path)
}

const everydayId = (page: Page) =>
  page.evaluate(async () => {
    const accounts = await window.ledger.accounts.list()
    return accounts.find((account) => account.name === 'Everyday')!.id
  })

ledgerTest(
  'imports a file through the open dialog, and undoes it',
  async ({ app, home }) => {
    await chooseFile(app, null)
    expect(await home.evaluate(() => window.ledger.imports.open())).toEqual({
      ok: false,
      reason: 'cancelled',
    })

    await chooseFile(app, sample('anz.csv'))
    const accountId = await everydayId(home)
    const result = await home.evaluate(async (accountId) => {
      const { imports } = window.ledger
      const opened = await imports.open()
      if (!opened.ok) return opened
      const request = {
        id: opened.file.id,
        encoding: opened.file.encoding,
        mapping: opened.file.mapping!,
        targets: [{ key: '', accountId }],
      }
      const preview = await imports.preview(request)
      if (!preview.ok) return preview
      const committed = await imports.commit(
        request,
        preview.preview.rows.map((row) => row.index),
      )
      const batches = await imports.batches()
      const undone = await imports.undo(batches[0]!.id)
      return {
        file: { name: opened.file.fileName, template: opened.file.template },
        statuses: preview.preview.rows.map((row) => row.status),
        committed,
        batches: batches.map(({ fileName, count, edited }) => ({
          fileName,
          count,
          edited,
        })),
        undone,
        after: await imports.batches(),
      }
    }, accountId)
    expect(result).toEqual({
      file: { name: 'anz.csv', template: 'anz' },
      statuses: ['new', 'new', 'new'],
      committed: { ok: true, id: expect.any(Number), count: 3 },
      batches: [{ fileName: 'anz.csv', count: 3, edited: 0 }],
      undone: { ok: true, count: 3 },
      after: [],
    })
  },
)

ledgerTest(
  'a lock drops the file waiting to be imported',
  async ({ app, home }) => {
    await chooseFile(app, sample('anz.csv'))
    const accountId = await everydayId(home)
    const request = await home.evaluate(async (accountId) => {
      const opened = await window.ledger.imports.open()
      if (!opened.ok) throw new Error(opened.reason)
      return {
        id: opened.file.id,
        encoding: opened.file.encoding,
        mapping: opened.file.mapping!,
        targets: [{ key: '', accountId }],
      }
    }, accountId)

    const locked = await replacedBy(app, () =>
      home
        .getByRole('navigation', { name: 'Ledger' })
        .getByRole('button', { name: 'Lock' })
        .click(),
    )
    await locked.getByLabel('Master password').fill(DEMO_PASSWORD)
    const unlocked = await replacedBy(app, () =>
      locked.getByRole('button', { name: 'Unlock' }).click(),
    )
    expect(
      await unlocked.evaluate(
        (request) => window.ledger.imports.preview(request),
        request,
      ),
    ).toEqual({
      ok: false,
      reason: 'not-found',
    })
  },
)
