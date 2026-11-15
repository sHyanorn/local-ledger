import { ipcMain } from 'electron'
import type { Channel } from '../shared/ipc'
import { createDispatcher } from './dispatch'
import type { Dispatch, Handle } from './dispatch'
import { isTrustedSender } from './security'

/**
 * Registers handlers on ipcMain that answer this app's frames and, while
 * developing, the dev server's.
 */
export function ipcHandlers(devOrigin?: string): {
  handle: Handle
  dispatch: Dispatch
  failNext: (channel: Channel) => void
} {
  const { handle, dispatch, failNext } = createDispatcher()
  return {
    handle: (channel, handler) => {
      handle(channel, handler)
      ipcMain.handle(channel, (event, payload) => {
        if (!isTrustedSender(event.senderFrame?.origin, devOrigin)) {
          throw new Error('forbidden')
        }
        return dispatch(channel, payload)
      })
    },
    dispatch,
    failNext,
  }
}
