import { EventEmitter } from 'node:events'
import type { PowerMonitor } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import {
  IDLE_LIMIT_SECONDS,
  IDLE_POLL_MS,
  watchForLock,
} from '../../src/main/auto-lock'

class FakePower extends EventEmitter {
  idle = 0
  getSystemIdleTime = () => this.idle
}

let power: FakePower
let lock: Mock<() => void>
let stop: () => void

beforeEach(() => {
  vi.useFakeTimers()
  power = new FakePower()
  lock = vi.fn<() => void>()
  stop = watchForLock(power as unknown as PowerMonitor, lock)
})
afterEach(() => {
  stop()
  vi.useRealTimers()
})

describe('watchForLock', () => {
  it('locks after five minutes of system idle time', () => {
    expect(IDLE_LIMIT_SECONDS).toBe(300)
    power.idle = IDLE_LIMIT_SECONDS - 1
    vi.advanceTimersByTime(IDLE_POLL_MS)
    expect(lock).not.toHaveBeenCalled()
    power.idle = IDLE_LIMIT_SECONDS
    vi.advanceTimersByTime(IDLE_POLL_MS)
    expect(lock).toHaveBeenCalledOnce()
  })

  it('locks once per idle period', () => {
    power.idle = IDLE_LIMIT_SECONDS
    vi.advanceTimersByTime(IDLE_POLL_MS * 3)
    expect(lock).toHaveBeenCalledOnce()
    power.idle = 0
    vi.advanceTimersByTime(IDLE_POLL_MS)
    power.idle = IDLE_LIMIT_SECONDS
    vi.advanceTimersByTime(IDLE_POLL_MS)
    expect(lock).toHaveBeenCalledTimes(2)
  })

  it.each(['lock-screen', 'suspend'])(
    'locks when the system emits %s',
    (event) => {
      power.emit(event)
      expect(lock).toHaveBeenCalledOnce()
    },
  )

  it('stops watching when asked', () => {
    stop()
    power.idle = IDLE_LIMIT_SECONDS
    vi.advanceTimersByTime(IDLE_POLL_MS * 2)
    power.emit('lock-screen')
    power.emit('suspend')
    expect(lock).not.toHaveBeenCalled()
  })
})

describe('a lock time from the settings', () => {
  it('is read on every poll, so a change applies at once', () => {
    const power = new FakePower()
    const lock = vi.fn<() => void>()
    vi.useFakeTimers()
    let minutes = 5
    const stop = watchForLock(power as unknown as PowerMonitor, lock, {
      idleLimit: () => minutes * 60,
    })
    power.idle = 60
    vi.advanceTimersByTime(IDLE_POLL_MS)
    expect(lock).not.toHaveBeenCalled()
    minutes = 1
    vi.advanceTimersByTime(IDLE_POLL_MS)
    expect(lock).toHaveBeenCalledOnce()
    stop()
  })
})
