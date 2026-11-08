import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { channels } from '../shared/ipc'
import { errorCode } from './error-code'
import type { Channel, Payload, Results } from '../shared/ipc'
import { isTrustedSender } from './security'
import { LockedError } from './vault/vault'

type Handler<C extends Channel> = (
  payload: Payload<C>,
) => Results[C] | Promise<Results[C]>

/**
 * Wraps a handler so it runs only for frames of this app and only on a
 * payload that matches the channel's schema. Only codes reach the page and
 * the log: never the payload, which may hold a password, nor an error
 * message, which may hold a path or a query.
 */
export function guard<C extends Channel>(
  channel: C,
  handler: Handler<C>,
  devOrigin?: string,
): (
  event: Pick<IpcMainInvokeEvent, 'senderFrame'>,
  payload: unknown,
) => Promise<Results[C]> {
  return async (event, payload) => {
    if (!isTrustedSender(event.senderFrame?.origin, devOrigin)) {
      throw new Error('forbidden')
    }
    const parsed = channels[channel].safeParse(payload)
    if (!parsed.success) throw new Error('invalid-argument')
    try {
      return await handler(parsed.data as Payload<C>)
    } catch (error) {
      // A page that outlived its vault state; it is about to be replaced.
      if (error instanceof LockedError) throw new Error('locked')
      console.error(`${channel} failed: ${errorCode(error)}`)
      throw new Error('failed')
    }
  }
}

/** Registers a guarded handler for a channel. */
export type Handle = <C extends Channel>(
  channel: C,
  handler: Handler<C>,
) => void

/**
 * Registers handlers that answer this app's frames and, while developing,
 * the dev server's.
 */
export function ipcHandlers(devOrigin?: string): Handle {
  return (channel, handler) =>
    ipcMain.handle(channel, guard(channel, handler, devOrigin))
}
