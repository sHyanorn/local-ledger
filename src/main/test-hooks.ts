import type { Channel } from '../shared/ipc'

/**
 * What the end-to-end tests reach through the main process of the
 * unpackaged app, as `globalThis.testHooks`. A packaged app has none.
 */
export interface TestHooks {
  /** The next call on the channel fails as if its handler had. */
  failNext(channel: Channel): void
  /** The first call on the channel after the next lock fails. */
  failAfterLock(channel: Channel): void
}

export function exposeTestHooks(hooks: TestHooks): void {
  Object.assign(globalThis, { testHooks: hooks })
}
