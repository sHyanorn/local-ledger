import { EventEmitter } from 'node:events'
import { utilityProcess } from 'electron'
import type { MessagePortMain } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VaultHost } from '../../src/main/host-process'

vi.mock('electron', () => ({
  utilityProcess: { fork: vi.fn() },
  MessageChannelMain: class {},
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

const start = () =>
  new VaultHost({
    entry: 'host.js',
    root: '/fake',
    services: {} as never,
    testHooks: false,
    onChange: vi.fn(),
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
