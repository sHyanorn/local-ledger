import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { DEMO_PASSWORD } from '../../scripts/seed/demo'
import { matchKey } from '../../src/main/ledger/match-key'
import { deriveHere, encodePassword } from '../../src/main/vault/kdf'
import { openKey } from '../../src/main/vault/keys'
import { parseVaultFile } from '../../src/main/vault/vault-file'
import { appProcesses, encoded, scanProcesses } from '../support/memory'
import type { Needles, ProcessScan } from '../support/memory'
import {
  chooseFile,
  expect,
  expectExited,
  ledgerTest as test,
  rendererPid,
  replacedBy,
  sidebar,
} from './fixtures'

// Reports what each process of the app holds in memory; it asserts nothing
// about the counts yet. Text that Playwright sends to a page crosses the
// main process, so the texts counted reach the app as a user's would: typed
// key by key, read from a file, or read from the seeded vault. The page
// sends back only counts.
test('the memory of every app process, unlocked and after a lock (report only)', async ({
  app,
  page,
  ledger,
  userData,
}, testInfo) => {
  test.setTimeout(600_000)
  // On Windows the process Playwright starts is the main process's parent.
  const mainPid = await app.evaluate(() => process.pid)

  await page.getByLabel('Master password').pressSequentially(DEMO_PASSWORD)
  const home = await replacedBy(app, () =>
    page.getByRole('button', { name: 'Unlock' }).click(),
  )
  await sidebar(home).getByRole('button', { name: 'All Transactions' }).click()

  // Counted by their random part, which the app's lower-case copies keep.
  const typed = randomUUID()
  await home.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = home.getByRole('dialog', { name: 'New Transaction' })
  await dialog.getByLabel('Description').pressSequentially(`Typed ${typed}`)
  await dialog.getByLabel('Amount').fill('1')
  await dialog.getByRole('button', { name: 'Add Transaction' }).click()
  await expect(dialog).toBeHidden()

  const imported = randomUUID()
  const csv = testInfo.outputPath('import.csv')
  writeFileSync(csv, `01/05/2026,"-1.00","Imported ${imported}"\n`)
  await chooseFile(app, csv)
  const count = await home.evaluate(async () => {
    const { accounts, imports } = window.ledger
    const account = (await accounts.list()).find(
      ({ name }) => name === 'Everyday',
    )
    const opened = await imports.open()
    if (!account || !opened.ok) return 'not opened'
    const request = {
      id: opened.file.id,
      encoding: opened.file.encoding,
      mapping: opened.file.mapping!,
      targets: [{ key: '', accountId: account.id }],
    }
    await imports.preview(request)
    const committed = await imports.commit(request, [0])
    return committed.ok ? committed.count : committed.reason
  })
  expect(count).toBe(1)

  const vault = parseVaultFile(
    readFileSync(join(userData, 'vault', 'vault.json'), 'utf8'),
  )
  if (!vault) throw new Error('no vault file')
  const sealingKey = await deriveHere(
    encodePassword(DEMO_PASSWORD),
    vault.kdf.salt,
    vault.kdf,
  )
  const key = await openKey(vault, DEMO_PASSWORD, deriveHere)
  if (!key) throw new Error('the data key did not open')
  const hex = key.toString('hex')

  // Known to be in the main process, and in the page shown.
  const control = `Control ${randomUUID()}`
  await app.evaluate((_electron, value) => {
    Object.assign(globalThis, { memoryControl: value })
  }, control)
  const pageControl = `Page control ${randomUUID()}`

  const seeds = [...new Set(ledger.transactions.map((row) => row.description))]
  const needles: Needles = {
    ...encoded('control', control),
    ...encoded('page control', pageControl),
    ...encoded('typed', typed),
    ...encoded('imported', imported),
    ...encoded('password', DEMO_PASSWORD),
    'sealing key': Buffer.from(sealingKey),
    'key raw': Buffer.from(key),
    // AES-256 key schedules keep one half of the key as it is.
    'key first half': Buffer.from(key.subarray(0, 16)),
    'key second half': Buffer.from(key.subarray(16)),
    ...encoded('key hex', hex),
    ...encoded("key x''", `x'${hex}'`),
  }
  seeds.forEach((description, index) => {
    Object.assign(needles, encoded(`seed ${index}`, description))
    // Rules and duplicate checks compare lower-case copies.
    if (matchKey(description) !== description) {
      Object.assign(
        needles,
        encoded(`seed ${index} key`, matchKey(description)),
      )
    }
  })
  key.fill(0)
  sealingKey.fill(0)

  const phases: Record<string, unknown> = {}
  const platform = `${process.platform} ${process.arch}`
  // Each phase is printed once read, so a step that fails later keeps it.
  console.log(
    `Memory, ${platform}, ${new Date().toISOString()}. Copies of each text as ascii/utf16, not counting those inside a longer text counted; seeds: how many of the ${seeds.length} descriptions have a copy in either case.`,
  )
  const measure = async (phase: string, shown: Page) => {
    await shown.evaluate((value) => {
      Object.assign(window, { memoryControl: value })
    }, pageControl)
    const pagePid = await rendererPid(app)
    const processes = appProcesses(mainPid)
    const metrics = await app.evaluate(({ app }) =>
      app.getAppMetrics().map(({ pid, type, memory }) => ({
        pid,
        type,
        workingSet: memory.workingSetSize * 1024,
      })),
    )
    const scans = scanProcesses(
      processes,
      needles,
      testInfo.outputPath('dumps'),
    ).map((scan) => ({
      ...scan,
      workingSet: metrics.find(({ pid }) => pid === scan.pid)?.workingSet,
    }))
    const main = scans.find(({ pid }) => pid === mainPid)!
    const renderer = scans.find(({ pid }) => pid === pagePid)
    const valid = {
      control: main.counts['control ascii']! > 0,
      pageControl: (renderer?.counts['page control ascii'] ?? 0) > 0,
      errors: scans.filter(({ error }) => error).length,
      unread: scans.reduce((sum, { unread }) => sum + (unread ?? 0), 0),
      // Processes Chromium counts that the walk by parent pid did not find.
      missed: metrics
        .filter(({ pid }) => !processes.some((found) => found.pid === pid))
        .map(({ pid, type }) => ({ pid, type })),
    }
    phases[phase] = { valid, pagePid, scans }
    console.log(
      [
        `${phase}: ${JSON.stringify(valid)}`,
        ...scans.map((scan) =>
          summary(scan, seeds.length, scan.pid === pagePid),
        ),
      ].join('\n'),
    )
  }

  await measure('unlocked', home)
  const shown = await rendererPid(app)
  const locked = await replacedBy(app, () =>
    sidebar(home).getByRole('button', { name: 'Lock' }).click(),
  )
  await expectExited(shown)
  await expect(locked.getByLabel('Master password')).toBeVisible()
  await app.evaluate(() => {
    process.getBuiltinModule('v8').setFlagsFromString('--expose-gc')
    ;(process.getBuiltinModule('vm').runInNewContext('gc') as () => void)()
  })
  await measure('locked, after a main GC', locked)
  await locked.waitForTimeout(30_000)
  await measure('30 s later', locked)

  const report = {
    when: new Date().toISOString(),
    platform,
    seeds: seeds.length,
    phases,
  }
  writeFileSync(
    testInfo.outputPath('memory.json'),
    JSON.stringify(report, null, 2),
  )
})

/** One line per process: the copies of each text, ascii/utf16. */
function summary(
  scan: ProcessScan & { workingSet?: number },
  seeds: number,
  page: boolean,
): string {
  const { counts } = scan
  const pair = (name: string) =>
    `${counts[`${name} ascii`]}/${counts[`${name} utf16`]}`
  const found = (encoding: string) =>
    Array.from({ length: seeds }).filter(
      (_, index) =>
        counts[`seed ${index} ${encoding}`]! +
          (counts[`seed ${index} key ${encoding}`] ?? 0) >
        0,
    ).length
  const mb = (bytes = 0) => (bytes / 2 ** 20).toFixed(1)
  const name = `  ${scan.type}${page ? ' (page shown)' : ''} ${scan.pid}:`
  if (scan.error) return `${name} error ${scan.error}`
  return [
    name,
    `read ${mb(scan.bytes)} MB${scan.unread === undefined ? '' : `, unread ${mb(scan.unread)} MB`}, working set ${mb(scan.workingSet)} MB;`,
    `control ${pair('control')}, page control ${pair('page control')},`,
    `typed ${pair('typed')}, imported ${pair('imported')}, seeds ${found('ascii')}/${found('utf16')},`,
    `password ${pair('password')}, sealing key ${counts['sealing key']},`,
    `key raw ${counts['key raw']}, halves ${counts['key first half']}/${counts['key second half']}, hex ${pair('key hex')}, x'' ${pair("key x''")}`,
  ].join(' ')
}
