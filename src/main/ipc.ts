import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { channels } from '../shared/ipc'
import type { Channel, Payload, Results } from '../shared/ipc'
import { isTrustedSender } from './security'

type Handler<C extends Channel> = (
  payload: Payload<C>,
) => Results[C] | Promise<Results[C]>

/**
 * Wraps a handler so it runs only for frames of this app and only on a
 * payload that matches the channel's schema. Errors carry a code and never
 * the payload, which may hold a password.
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
    return handler(parsed.data as Payload<C>)
  }
}

export function handle<C extends Channel>(
  channel: C,
  handler: Handler<C>,
  devOrigin?: string,
): void {
  ipcMain.handle(channel, guard(channel, handler, devOrigin))
}
