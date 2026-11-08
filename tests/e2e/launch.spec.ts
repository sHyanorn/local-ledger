import { expect, test } from './fixtures'

test('a first launch asks for a master password', async ({ page }) => {
  await expect(page).toHaveTitle('Local Ledger')
  await expect(
    page.getByRole('heading', { name: 'Create a master password' }),
  ).toBeVisible()
})
