import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { channels } from '../shared/ipc'
import { errorCode } from './error-code'
import type { Channel, Payload, Results } from '../shared/ipc'
import { isTrustedSender } from './security'

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
      console.error(`${channel} failed: ${errorCode(error)}`)
      throw new Error('failed')
    }
  }
}

export function handle<C extends Channel>(
  channel: C,
  handler: Handler<C>,
  devOrigin?: string,
): void {
  ipcMain.handle(channel, guard(channel, handler, devOrigin))
}
