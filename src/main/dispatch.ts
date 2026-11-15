import { channels } from '../shared/ipc'
import type { Channel, Payload, Results } from '../shared/ipc'
import { errorCode } from './error-code'
import { LockedError } from './vault/vault'

export type Handler<C extends Channel> = (
  payload: Payload<C>,
) => Results[C] | Promise<Results[C]>

/** Registers the handler of a channel. */
export type Handle = <C extends Channel>(
  channel: C,
  handler: Handler<C>,
) => void

/** Runs a call; fails with only a code. */
export type Dispatch = (channel: string, payload: unknown) => Promise<unknown>

/**
 * Handlers by channel, for whichever transport delivers the calls. A call
 * runs only on a payload that matches its channel's schema. Only codes
 * reach the caller and the log: never the payload, which may hold a
 * password, nor an error message, which may hold a path or a query.
 */
export function createDispatcher(): { handle: Handle; dispatch: Dispatch } {
  const handlers = new Map<string, (payload: never) => unknown>()
  return {
    handle: (channel, handler) => {
      if (handlers.has(channel)) throw new Error(`${channel} has a handler`)
      handlers.set(channel, handler)
    },
    dispatch: async (channel, payload) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error('unknown-channel')
      const parsed = channels[channel as Channel].safeParse(payload)
      if (!parsed.success) throw new Error('invalid-argument')
      try {
        return await handler(parsed.data as never)
      } catch (error) {
        // A page that outlived its vault state; it is about to be replaced.
        if (error instanceof LockedError) throw new Error('locked')
        console.error(`${channel} failed: ${errorCode(error)}`)
        throw new Error('failed')
      }
    },
  }
}
