import type { PowerMonitor } from 'electron'

/** Locks after this much time without input anywhere on the computer. */
export const IDLE_LIMIT_SECONDS = 5 * 60
export const IDLE_POLL_MS = 5_000

type Power = Pick<PowerMonitor, 'getSystemIdleTime' | 'on' | 'off'>

/**
 * Calls lock once the system has been idle for the limit, and whenever the
 * operating system locks the screen or goes to sleep. Returns a function
 * that stops watching.
 */
export function watchForLock(
  power: Power,
  lock: () => void,
  { idleLimit = IDLE_LIMIT_SECONDS, pollMs = IDLE_POLL_MS } = {},
): () => void {
  const timer = setInterval(() => {
    if (power.getSystemIdleTime() >= idleLimit) lock()
  }, pollMs)
  power.on('lock-screen', lock)
  power.on('suspend', lock)
  return () => {
    clearInterval(timer)
    power.off('lock-screen', lock)
    power.off('suspend', lock)
  }
}
