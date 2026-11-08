import { describe, expect, it, vi } from 'vitest'
import { guard } from '../../src/main/ipc'
import { LockedError } from '../../src/main/vault/vault'
import { PASSWORD_MIN, passwordLength } from '../../src/shared/password'

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

  it('passes on only a code when the handler fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = Object.assign(
      new Error("EIO: i/o error, open '/home/fake/vault/ledger-2.db'"),
      { code: 'EIO' },
    )
    const listener = guard('vault:unlock', () => Promise.reject(failure))
    await expect(listener(APP, { password: strong })).rejects.toThrow(
      /^failed$/,
    )
    expect(log).toHaveBeenCalledWith('vault:unlock failed: EIO')
    log.mockRestore()
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

describe('data channels', () => {
  const ok = () => ({ ok: true as const, id: 1 })
  const account = {
    name: 'Fake Everyday',
    type: 'bank',
    currency: 'AUD',
    openingBalanceCents: 0,
  }
  const transaction = {
    accountId: 1,
    date: '2026-01-31',
    amountCents: -1250,
    description: 'Fake purchase',
    categoryId: null,
    notes: '',
  }

  it('store text in composed form, so look-alike names collide', async () => {
    const handler = vi.fn(ok)
    await guard('accounts:create', handler)(APP, {
      ...account,
      name: 'Cafe\u0301',
    })
    expect(handler).toHaveBeenCalledWith({ ...account, name: 'Caf\u00e9' })
  })

  it('pass trimmed text to the handler', async () => {
    const handler = vi.fn(ok)
    await guard('accounts:create', handler)(APP, {
      ...account,
      name: '  Fake Everyday  ',
    })
    expect(handler).toHaveBeenCalledWith(account)
  })

  it.each([
    ['accounts:create', { ...account, name: '   ' }],
    ['accounts:create', { ...account, name: 'x'.repeat(101) }],
    ['accounts:create', { ...account, currency: 'JPY' }],
    ['accounts:create', { ...account, type: 'loan' }],
    ['accounts:create', { ...account, openingBalanceCents: 0.5 }],
    ['accounts:create', { ...account, openingBalanceCents: 1e14 }],
    ['accounts:update', account],
    ['accounts:delete', { id: 0 }],
    ['accounts:delete', { id: '1' }],
    ['categories:create', { name: 'Fake', parentId: -1 }],
    ['categories:create', { name: 'Fake' }],
    ['transactions:create', { ...transaction, date: '2026-02-30' }],
    ['transactions:create', { ...transaction, date: '31/01/2026' }],
    ['transactions:create', { ...transaction, description: '' }],
    ['transactions:create', { ...transaction, notes: 'x'.repeat(2001) }],
    ['transactions:create', { ...transaction, amountCents: Number.NaN }],
    ['transactions:create', { ...transaction, extra: true }],
    ['transactions:page', { filter: {}, limit: 501 }],
    ['transactions:page', { filter: { category: 'all' }, limit: 10 }],
    ['transactions:page', { filter: { text: 'x'.repeat(201) }, limit: 10 }],
    [
      'transactions:page',
      { filter: {}, limit: 10, after: { date: 'x', id: 1 } },
    ],
    ['transactions:totals', { accountId: 1, sql: '1=1' }],
  ] as const)('%s refuses %j', async (channel, payload) => {
    const handler = vi.fn()
    await expect(guard(channel, handler)(APP, payload)).rejects.toThrow(
      /^invalid-argument$/,
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('accept a page request for uncategorized transactions', async () => {
    const handler = vi.fn(() => ({ rows: [], next: null }))
    await guard('transactions:page', handler)(APP, {
      filter: { category: 'none', from: '2026-01-01', text: '50%' },
      limit: 200,
      after: { date: '2026-01-31', id: 7 },
    })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('report a locked vault by its own code, without logging', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const listener = guard('accounts:list', () => {
      throw new LockedError()
    })
    await expect(listener(APP, undefined)).rejects.toThrow(/^locked$/)
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})
