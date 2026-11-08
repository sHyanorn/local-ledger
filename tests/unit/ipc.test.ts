import { describe, expect, it, vi } from 'vitest'
import { guard } from '../../src/main/ipc'
import { PASSWORD_MIN, passwordLength } from '../../src/shared/ipc'

vi.mock('electron', () => ({ ipcMain: {} }))

const APP = { senderFrame: { origin: 'app://local-ledger' } } as never
const from = (origin: string) => ({ senderFrame: { origin } }) as never
const strong = 'correct horse battery staple'

describe('guard', () => {
  it('runs the handler for the app with a valid payload', async () => {
    const handler = vi.fn(() => ({ ok: true as const }))
    const listener = guard('vault:unlock', handler)
    await expect(listener(APP, { password: strong })).resolves.toEqual({
      ok: true,
    })
    expect(handler).toHaveBeenCalledWith({ password: strong })
  })

  it.each(['https://example.com', 'null', 'app://other', 'file://'])(
    'refuses a sender from %s',
    async (origin) => {
      const handler = vi.fn()
      await expect(
        guard('vault:status', handler)(from(origin), undefined),
      ).rejects.toThrow('forbidden')
      expect(handler).not.toHaveBeenCalled()
    },
  )

  it('refuses a frame that has gone away', async () => {
    const event = { senderFrame: null } as never
    await expect(
      guard('vault:status', vi.fn())(event, undefined),
    ).rejects.toThrow('forbidden')
  })

  it('accepts the dev server only when one is given', async () => {
    const dev = 'http://localhost:5173'
    await expect(
      guard('vault:status', () => 'new', dev)(from(dev), undefined),
    ).resolves.toBe('new')
    await expect(
      guard('vault:status', () => 'new')(from(dev), undefined),
    ).rejects.toThrow('forbidden')
  })

  it.each([
    ['a missing field', {}],
    ['an extra field', { password: strong, admin: true }],
    ['a wrong type', { password: 42 }],
    ['a payload on a channel that takes none', 'surprise'],
    ['an empty password', { password: '' }],
    ['an oversized password', { password: 'x'.repeat(5000) }],
  ])('refuses %s without echoing it', async (_label, payload) => {
    const handler = vi.fn()
    const channel =
      typeof payload === 'string' ? 'vault:status' : 'vault:unlock'
    const result = guard(channel, handler)(APP, payload)
    await expect(result).rejects.toThrow(/^invalid-argument$/)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('new passwords', () => {
  const create = guard('vault:create', () => ({ ok: true as const }))

  it(`need ${PASSWORD_MIN} code points after NFKC`, async () => {
    await expect(
      create(APP, { password: 'x'.repeat(PASSWORD_MIN - 1) }),
    ).rejects.toThrow()
    await expect(
      create(APP, { password: 'x'.repeat(PASSWORD_MIN) }),
    ).resolves.toEqual({
      ok: true,
    })
  })

  it('count code points, not UTF-16 units', () => {
    expect(passwordLength('🔒'.repeat(PASSWORD_MIN))).toBe(PASSWORD_MIN)
    expect('🔒'.repeat(PASSWORD_MIN).length).toBe(PASSWORD_MIN * 2)
  })

  it('count after NFKC, which folds compatibility forms', () => {
    // U+FB01 LATIN SMALL LIGATURE FI becomes "fi".
    expect(passwordLength(String.fromCodePoint(0xfb01))).toBe(2)
  })

  it('accept a long passphrase', async () => {
    await expect(create(APP, { password: 'a'.repeat(1024) })).resolves.toEqual({
      ok: true,
    })
    await expect(create(APP, { password: 'a'.repeat(1025) })).rejects.toThrow()
  })
})
