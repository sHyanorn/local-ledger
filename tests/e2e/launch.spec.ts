import { expect, test } from './fixtures'

test('a first launch asks for a master password', async ({ page }) => {
  await expect(page).toHaveTitle('Local Ledger')
  await expect(
    page.getByRole('heading', { name: 'Create a master password' }),
  ).toBeVisible()
})

test('a lock before the first page loads still shows the window', async ({
  app,
}) => {
  await app.evaluate(({ app, BaseWindow }) => {
    // As on macOS, where the app keeps running without a window.
    app.removeAllListeners('window-all-closed')
    BaseWindow.getAllWindows()[0]?.close()
  })
  await expect
    .poll(() =>
      app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length),
    )
    .toBe(0)
  // Reopen from the Dock and lock in the same turn, before the page loads.
  await app.evaluate(({ app, powerMonitor }) => {
    app.emit('activate')
    powerMonitor.emit('lock-screen')
  })
  await expect
    .poll(() =>
      app.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]?.isVisible(),
      ),
    )
    .toBe(true)
})
