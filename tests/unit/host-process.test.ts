import { EventEmitter } from 'node:events'
import { utilityProcess } from 'electron'
import type { MessagePortMain } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VaultHost } from '../../src/main/host-process'

vi.mock('electron', () => ({
  utilityProcess: { fork: vi.fn() },
  MessageChannelMain: class {
    port1 = { once: vi.fn(), start: vi.fn(), postMessage: vi.fn() }
    port2 = { close: vi.fn() }
  },
}))

/** A vault host process, as the main process sees it. */
class FakeHost extends EventEmitter {
  postMessage = vi.fn()
  kill = vi.fn(() => true)
}

let forked: FakeHost[]
beforeEach(() => {
  forked = []
  vi.mocked(utilityProcess.fork).mockImplementation(() => {
    const host = new FakeHost()
    forked.push(host)
    return host as never
  })
})
afterEach(() => {
  vi.useRealTimers()
})

const start = (onChange = vi.fn()) =>
  new VaultHost({
    entry: 'host.js',
    root: '/fake',
    services: {} as never,
    testHooks: false,
    onChange,
    onIdle: vi.fn(),
  })
const page = () => ({ close: vi.fn() }) as unknown as MessagePortMain

it('kills a host that has not exited 30 seconds after a lock', () => {
  vi.useFakeTimers()
  const vaultHost = start()
  vaultHost.connect(page())
  vaultHost.lock()
  vi.advanceTimersByTime(29_999)
  expect(forked[0]!.kill).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(forked[0]!.kill).toHaveBeenCalledOnce()
})

it('starts no host for a page that went while the last host ended', () => {
  const vaultHost = start()
  vaultHost.connect(page())
  vaultHost.lock()
  // The locked page waits for the next host; then its window closes.
  vaultHost.connect(page())
  vaultHost.lock()
  forked[0]!.emit('exit', 0)
  expect(forked).toHaveLength(1)
  expect(vaultHost.running).toBe(false)
})

it('does not replace the page for a host that ended before it was ready, and fails what waits on it', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const onChange = vi.fn()
  const vaultHost = start(onChange)
  const calling = vaultHost.call('vault:status', undefined)
  const probing = vaultHost.probe()
  forked[0]!.emit('exit', 1)
  await expect(calling).rejects.toThrow('the vault host ended')
  await expect(probing).resolves.toBeNull()
  // A new page would start a new host, which would end the same way.
  expect(onChange).not.toHaveBeenCalled()
  expect(log).toHaveBeenCalledWith('the vault host ended before it was ready')
  log.mockRestore()
})

it('gives a probe only the answer of the host it asked', async () => {
  const vaultHost = start()
  vaultHost.connect(page())
  const first = vaultHost.probe()
  vaultHost.lock()
  forked[0]!.emit('exit', 0)
  vaultHost.connect(page())
  const second = vaultHost.probe()
  const probe = { sqlite: '3', cipher: 'sqlcipher' }
  forked[1]!.emit('message', { type: 'probe', probe })
  await expect(first).resolves.toBeNull()
  await expect(second).resolves.toEqual(probe)
})
