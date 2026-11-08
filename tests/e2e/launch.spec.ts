import { expect, test } from './fixtures'

test('the app opens its main window', async ({ page }) => {
  await expect(page).toHaveTitle('Local Ledger')
  await expect(
    page.getByRole('heading', { name: 'Local Ledger' }),
  ).toBeVisible()
})
