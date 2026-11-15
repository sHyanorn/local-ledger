// The vault host: a process of its own that each lock ends, and whose end,
// asked for or not, leaves the vault locked.
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
