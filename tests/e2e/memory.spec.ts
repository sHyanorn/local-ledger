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
  saveTo,
  sidebar,
  vaultHosts,
} from './fixtures'

// Reads the memory of every process of the app, unlocked and after a lock,
// prints what each holds, and checks where the ledger's texts and key are
// found. Text that Playwright sends to a page crosses the main process, so
// the texts counted reach the app as a user's would: typed key by key, read
// from a file, or read from the seeded vault. The page sends back only
// counts.
test('the main process holds no ledger data or key but typed text and a page printed to PDF, and after a lock no other process holds any', async ({
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

  // The printed row is alone in its month, so the PDF of that month, which
  // the main process prints, holds no other text counted.
  const imported = randomUUID()
  const printed = randomUUID()
  const csv = testInfo.outputPath('import.csv')
  writeFileSync(
    csv,
    `01/05/2026,"-1.00","Imported ${imported}"\n15/01/2019,"-1.00","Printed ${printed}"\n`,
  )
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
    const committed = await imports.commit(request, [0, 1])
    return committed.ok ? committed.count : committed.reason
  })
  expect(count).toBe(2)
  const before = appProcesses(mainPid).map(({ pid }) => pid)
  await saveTo(app, testInfo.outputPath('statement.pdf'))
  expect(
    await home.evaluate(() =>
      window.ledger.export.save('2019-01', 'AUD', 'pdf'),
    ),
  ).toEqual({ ok: true })
  // Printing runs in processes of its own, which end once it is done.
  await expect
    .poll(() =>
      appProcesses(mainPid).filter(({ pid }) => !before.includes(pid)),
    )
    .toEqual([])

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
    ...encoded('printed', printed),
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

  const phases: Record<string, Phase> = {}
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
    // A process that could not be read leaves nothing to check.
    expect(valid.errors, phase).toBe(0)
  }

  await measure('unlocked', home)
  const shown = await rendererPid(app)
  const [host] = await vaultHosts(app)
  const locked = await replacedBy(app, () =>
    sidebar(home).getByRole('button', { name: 'Lock' }).click(),
  )
  await expectExited(shown)
  await expectExited(host!)
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

  // A core on macOS holds the pages lldb counts as written, and now and then
  // not the one with the main process's control; the main process is then
  // not checked in that phase.
  const partial = (phase: string) =>
    process.platform === 'darwin' && !phases[phase]!.valid.control
  for (const [phase, { valid }] of Object.entries(phases)) {
    expect(
      { ...valid, control: valid.control || partial(phase) },
      phase,
    ).toEqual({
      control: true,
      pageControl: true,
      errors: 0,
      unread: 0,
      missed: [],
    })
  }
  // The host holds the ledger and its key while unlocked: the counts find
  // what the app keeps.
  const unlocked = phases.unlocked!.scans.find(({ pid }) => pid === host)!
  expect(held(unlocked.counts)).toEqual(
    expect.arrayContaining(['imported ascii', 'printed ascii', 'key raw']),
  )
  expect(seedsFound(unlocked.counts, seeds.length, 'ascii')).toBe(seeds.length)
  // The main process prints the page, and its copies of the typed text come
  // from Chromium or the test driver, not from the app's calls, which go to
  // the host.
  const residue = Object.entries(phases).flatMap(([phase, { scans }]) =>
    scans
      .filter(({ pid }) =>
        pid === mainPid ? !partial(phase) : phase !== 'unlocked',
      )
      .flatMap(({ pid, type, counts }) =>
        held(counts)
          .filter((name) => pid !== mainPid || !/^(typed|printed) /.test(name))
          .map((name) => `${phase}: ${type} ${pid} holds ${name}`),
      ),
  )
  expect(residue).toEqual([])
})

interface Phase {
  valid: Record<string, unknown>
  pagePid: number
  scans: (ProcessScan & { workingSet?: number })[]
}

/** The needles a process holds a copy of, but for the test's own controls. */
const held = (counts: ProcessScan['counts']) =>
  Object.keys(counts).filter(
    (name) => counts[name]! > 0 && !/^(page )?control /.test(name),
  )

/** How many seed descriptions have a copy in either case. */
const seedsFound = (
  counts: ProcessScan['counts'],
  seeds: number,
  encoding: string,
) =>
  Array.from({ length: seeds }).filter(
    (_, index) =>
      counts[`seed ${index} ${encoding}`]! +
        (counts[`seed ${index} key ${encoding}`] ?? 0) >
      0,
  ).length

/** One line per process: the copies of each text, ascii/utf16. */
function summary(
  scan: ProcessScan & { workingSet?: number },
  seeds: number,
  page: boolean,
): string {
  const { counts } = scan
  const pair = (name: string) =>
    `${counts[`${name} ascii`]}/${counts[`${name} utf16`]}`
  const found = (encoding: string) => seedsFound(counts, seeds, encoding)
  const mb = (bytes = 0) => (bytes / 2 ** 20).toFixed(1)
  const name = `  ${scan.type}${page ? ' (page shown)' : ''} ${scan.pid}:`
  if (scan.error) return `${name} error ${scan.error}`
  return [
    name,
    `read ${mb(scan.bytes)} MB${scan.unread === undefined ? '' : `, unread ${mb(scan.unread)} MB`}, working set ${mb(scan.workingSet)} MB;`,
    `control ${pair('control')}, page control ${pair('page control')},`,
    `typed ${pair('typed')}, imported ${pair('imported')}, printed ${pair('printed')}, seeds ${found('ascii')}/${found('utf16')},`,
    `password ${pair('password')}, sealing key ${counts['sealing key']},`,
    `key raw ${counts['key raw']}, halves ${counts['key first half']}/${counts['key second half']}, hex ${pair('key hex')}, x'' ${pair("key x''")}`,
  ].join(' ')
}
