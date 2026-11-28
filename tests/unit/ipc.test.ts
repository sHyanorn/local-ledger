import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDispatcher } from '../../src/main/dispatch'
import type { Handler } from '../../src/main/dispatch'
import { listenToPages } from '../../src/main/ipc'
import { LockedError } from '../../src/main/vault/vault'
import type { Channel } from '../../src/shared/ipc'
import { PASSWORD_MIN, passwordLength } from '../../src/shared/password'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  MessageChannelMain: class {
    port1 = { name: 'port1' }
    port2 = { name: 'port2', pair: this.port1 }
  },
}))

const APP = 'app://local-ledger'

const strong = 'correct horse battery staple'

/** A dispatcher with one handler, called on the channel. */
function dispatchTo<C extends Channel>(channel: C, handler: Handler<C>) {
  const { handle, dispatch } = createDispatcher()
  handle(channel, handler)
  return (payload: unknown) => dispatch(channel, payload)
}

describe('dispatch', () => {
  it('runs the handler with a valid payload', async () => {
    const handler = vi.fn(() => ({ ok: true as const }))
    await expect(
      dispatchTo('vault:unlock', handler)({ password: strong }),
    ).resolves.toEqual({ ok: true })
    expect(handler).toHaveBeenCalledWith({ password: strong })
  })

  it.each(['vault:unknown', 'toString', '__proto__', 'constructor'])(
    'refuses %s, a channel without a handler',
    async (channel) => {
      const { handle, dispatch } = createDispatcher()
      const handler = vi.fn()
      handle('vault:status', handler)
      await expect(dispatch(channel, undefined)).rejects.toThrow(
        /^unknown-channel$/,
      )
      expect(handler).not.toHaveBeenCalled()
    },
  )

  it('fails the next call on a channel once when told to', async () => {
    const { handle, dispatch, failNext } = createDispatcher()
    handle('vault:status', () => 'new')
    handle('accounts:list', () => [])
    failNext('vault:status')
    await expect(dispatch('accounts:list', undefined)).resolves.toEqual([])
    await expect(dispatch('vault:status', undefined)).rejects.toThrow(
      /^failed$/,
    )
    await expect(dispatch('vault:status', undefined)).resolves.toBe('new')
  })

  it('refuses calls once closed, and settles after those running', async () => {
    const { handle, dispatch, close } = createDispatcher()
    let finish = () => {}
    handle(
      'vault:status',
      () => new Promise((resolve) => (finish = () => resolve('locked'))),
    )
    const running = dispatch('vault:status', undefined)
    let closed = false
    const closing = close().then(() => (closed = true))
    await expect(dispatch('vault:status', undefined)).rejects.toThrow(
      /^locked$/,
    )
    expect(closed).toBe(false)
    finish()
    await closing
    await expect(running).resolves.toBe('locked')
  })

  it('takes one handler per channel', () => {
    const { handle } = createDispatcher()
    handle('vault:status', () => 'new')
    expect(() => handle('vault:status', () => 'new')).toThrow()
  })

  it('passes on only a code when the handler fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = Object.assign(
      new Error("EIO: i/o error, open '/home/fake/vault/ledger-2.db'"),
      { code: 'EIO' },
    )
    const call = dispatchTo('vault:unlock', () => Promise.reject(failure))
    await expect(call({ password: strong })).rejects.toThrow(/^failed$/)
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
    await expect(dispatchTo(channel, handler)(payload)).rejects.toThrow(
      /^invalid-argument$/,
    )
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('ipcMain', () => {
  const lock = vi.fn()
  const connect = vi.fn()
  /** The listeners the main process puts on ipcMain. */
  function listen(devOrigin?: string) {
    vi.mocked(ipcMain.handle).mockClear()
    vi.mocked(ipcMain.on).mockClear()
    listenToPages(devOrigin, { lock, connect })
    expect(vi.mocked(ipcMain.handle).mock.calls.map(([name]) => name)).toEqual([
      'vault:lock',
    ])
    expect(vi.mocked(ipcMain.on).mock.calls.map(([name]) => name)).toEqual([
      'vault:port',
    ])
    return {
      lock: vi.mocked(ipcMain.handle).mock.calls[0]![1],
      port: vi.mocked(ipcMain.on).mock.calls[0]![1],
    }
  }
  const frame = (origin: string) => ({ origin, postMessage: vi.fn() })
  beforeEach(() => {
    lock.mockClear()
    connect.mockClear()
  })

  it('locks for the app', async () => {
    await listen().lock({ senderFrame: frame(APP) } as never, undefined)
    expect(lock).toHaveBeenCalledOnce()
  })

  it.each(['https://example.com', 'null', 'app://other', 'file://'])(
    'refuses a lock or a port to a sender from %s',
    async (origin) => {
      const listeners = listen()
      const sender = frame(origin)
      expect(() =>
        listeners.lock({ senderFrame: sender } as never, undefined),
      ).toThrow(/^forbidden$/)
      listeners.port({ senderFrame: sender } as never)
      expect(lock).not.toHaveBeenCalled()
      expect(connect).not.toHaveBeenCalled()
      expect(sender.postMessage).not.toHaveBeenCalled()
    },
  )

  it('refuses a frame that has gone away', () => {
    const listeners = listen()
    expect(() =>
      listeners.lock({ senderFrame: null } as never, undefined),
    ).toThrow(/^forbidden$/)
    listeners.port({ senderFrame: null } as never)
    expect(lock).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('refuses a lock with a payload', () => {
    expect(() =>
      listen().lock({ senderFrame: frame(APP) } as never, 'surprise'),
    ).toThrow(/^invalid-argument$/)
    expect(lock).not.toHaveBeenCalled()
  })

  it('gives the app one end of a channel and the host the other', () => {
    const sender = frame(APP)
    listen().port({ senderFrame: sender } as never)
    const [name, , [port]] = sender.postMessage.mock.calls[0]!
    expect(name).toBe('vault:port')
    expect(connect).toHaveBeenCalledOnce()
    expect(connect.mock.calls[0]![0]).not.toBe(port)
    expect(connect.mock.calls[0]![0].pair).toBe(port)
  })

  it('accepts the dev server only when one is given', () => {
    const dev = 'http://localhost:5173'
    listen(dev).port({ senderFrame: frame(dev) } as never)
    expect(connect).toHaveBeenCalledOnce()
    const listeners = listen()
    const sender = frame(dev)
    expect(() =>
      listeners.lock({ senderFrame: sender } as never, undefined),
    ).toThrow(/^forbidden$/)
    listeners.port({ senderFrame: sender } as never)
    expect(connect).toHaveBeenCalledOnce()
    expect(sender.postMessage).not.toHaveBeenCalled()
  })
})

describe('new passwords', () => {
  const create = dispatchTo('vault:create', () => ({ ok: true as const }))

  it(`need ${PASSWORD_MIN} code points after NFKC`, async () => {
    await expect(
      create({ password: 'x'.repeat(PASSWORD_MIN - 1) }),
    ).rejects.toThrow()
    await expect(
      create({ password: 'x'.repeat(PASSWORD_MIN) }),
    ).resolves.toEqual({
      ok: true,
    })
  })

  it('count code points, not UTF-16 units', async () => {
    expect(passwordLength('🔒'.repeat(PASSWORD_MIN))).toBe(PASSWORD_MIN)
    expect('🔒'.repeat(PASSWORD_MIN).length).toBe(PASSWORD_MIN * 2)
    await expect(
      create({ password: '🔒'.repeat(PASSWORD_MIN - 1) }),
    ).rejects.toThrow()
    await expect(
      create({ password: '🔒'.repeat(PASSWORD_MIN) }),
    ).resolves.toEqual({ ok: true })
  })

  it('count after NFKC, which folds compatibility forms', () => {
    // U+FB01 LATIN SMALL LIGATURE FI becomes "fi".
    expect(passwordLength(String.fromCodePoint(0xfb01))).toBe(2)
  })

  it('accept a long passphrase', async () => {
    await expect(create({ password: 'a'.repeat(1024) })).resolves.toEqual({
      ok: true,
    })
    await expect(create({ password: 'a'.repeat(1025) })).rejects.toThrow()
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
    await dispatchTo(
      'accounts:create',
      handler,
    )({
      ...account,
      name: 'Cafe\u0301',
    })
    expect(handler).toHaveBeenCalledWith({ ...account, name: 'Caf\u00e9' })
  })

  it('pass trimmed text to the handler', async () => {
    const handler = vi.fn(ok)
    await dispatchTo(
      'accounts:create',
      handler,
    )({
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
    ['accounts:archive', { id: 1, archived: 1 }],
    ['accounts:archive', { id: 1 }],
    ['accounts:archive', { id: 0, archived: true }],
    ['accounts:archive', { id: 1, archived: true, extra: 1 }],
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
    await expect(dispatchTo(channel, handler)(payload)).rejects.toThrow(
      /^invalid-argument$/,
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('accept a page request for uncategorized transactions', async () => {
    const handler = vi.fn(() => ({ rows: [], next: null }))
    await dispatchTo(
      'transactions:page',
      handler,
    )({
      filter: { category: 'none', from: '2026-01-01', text: '50%' },
      limit: 200,
      after: { date: '2026-01-31', id: 7 },
    })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('report a locked vault by its own code, without logging', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const call = dispatchTo('accounts:list', () => {
      throw new LockedError()
    })
    await expect(call(undefined)).rejects.toThrow(/^locked$/)
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})
