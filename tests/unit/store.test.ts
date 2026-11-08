// The page's vault store, with the preload API stubbed.
import { beforeEach, expect, it, vi } from 'vitest'
import { PASSWORD_MAX } from '../../src/shared/password'
import { PASSWORD } from '../support/vault'

const vault = {
  status: vi.fn(),
  create: vi.fn(),
  unlock: vi.fn(),
  lock: vi.fn(),
  changePassword: vi.fn(),
}
vi.stubGlobal('window', { ledger: { version: 'test', vault } })
const { useVault } = await import('../../src/renderer/src/store')

beforeEach(() => {
  vi.clearAllMocks()
  useVault.setState({ busy: false, notice: null })
})

it.each(['create', 'unlock'] as const)(
  'frees the form and says so when %s fails',
  async (action) => {
    vault[action].mockRejectedValue(new Error('failed'))
    await useVault.getState()[action](PASSWORD)
    expect(useVault.getState()).toMatchObject({ busy: false, notice: 'failed' })
  },
)

it('reports a refusal from the main process', async () => {
  vault.unlock.mockResolvedValue({ ok: false, reason: 'wrong-password' })
  await useVault.getState().unlock(PASSWORD)
  expect(useVault.getState()).toMatchObject({
    busy: false,
    notice: 'wrong-password',
  })
})

it('calls a password longer than any accepted one wrong without sending it', async () => {
  await useVault.getState().unlock('x'.repeat(PASSWORD_MAX + 1))
  expect(vault.unlock).not.toHaveBeenCalled()
  expect(useVault.getState().notice).toBe('wrong-password')
})
