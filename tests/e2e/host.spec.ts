// The vault host: a process of its own that each lock ends, and whose end,
// asked for or not, leaves the vault locked.
import { readdirSync, readFileSync } from 'node:fs'
import {
  expect,
  expectExited,
  ledgerTest as test,
  lockScreen,
  replacedBy,
  vaultHosts as hosts,
} from './fixtures'

test('a lock ends the vault host, and the locked page has a new one', async ({
  app,
  home,
}) => {
  await expect(
    home.getByRole('heading', { name: 'All Transactions' }),
  ).toBeVisible()
  const [unlocked, ...others] = await hosts(app)
  expect(others).toEqual([])
  const locked = await lockScreen(app)
  await expectExited(unlocked!)
  expect(await locked.evaluate(() => window.ledger.vault.status())).toBe(
    'locked',
  )
  const now = await hosts(app)
  expect(now).toHaveLength(1)
  expect(now[0]).not.toBe(unlocked)
})

test('a vault host that ends unasked leaves the vault locked', async ({
  app,
  home,
}) => {
  await expect(
    home.getByRole('heading', { name: 'All Transactions' }),
  ).toBeVisible()
  const [pid] = await hosts(app)
  const locked = await replacedBy(app, async () =>
    process.kill(pid!, 'SIGKILL'),
  )
  await expect(locked.getByLabel('Master password')).toBeVisible()
  expect(await locked.evaluate(() => window.ledger.vault.status())).toBe(
    'locked',
  )
})

test('a save under way at a lock finishes before the vault host ends', async ({
  app,
  home,
}, testInfo) => {
  const path = testInfo.outputPath('statement.xlsx')
  // The screen locks once the dialog has answered, so the lock reaches the
  // host just after the path, while the export writes the file.
  await app.evaluate(({ dialog, powerMonitor }, path) => {
    dialog.showSaveDialog = (async () => {
      setImmediate(() => powerMonitor.emit('lock-screen'))
      return { canceled: false, filePath: path }
    }) as typeof dialog.showSaveDialog
  }, path)
  const [host] = await hosts(app)
  await replacedBy(app, () =>
    home.evaluate(() => {
      void window.ledger.export.save('2026-05', 'AUD', 'xlsx')
    }),
  )
  await expectExited(host!)
  // The whole file, and no temporary one beside it.
  expect(
    readdirSync(testInfo.outputDir).filter((name) =>
      name.startsWith('statement.xlsx'),
    ),
  ).toEqual(['statement.xlsx'])
  expect(readFileSync(path).subarray(0, 2).toString('latin1')).toBe('PK')
})
