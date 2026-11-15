import { ipcMain } from 'electron'
import { createDispatcher } from './dispatch'
import type { Handle } from './dispatch'
import { isTrustedSender } from './security'

/**
 * Registers handlers on ipcMain that answer this app's frames and, while
 * developing, the dev server's.
 */
export function ipcHandlers(devOrigin?: string): Handle {
  const { handle, dispatch } = createDispatcher()
  return (channel, handler) => {
    handle(channel, handler)
    ipcMain.handle(channel, (event, payload) => {
      if (!isTrustedSender(event.senderFrame?.origin, devOrigin)) {
        throw new Error('forbidden')
      }
      return dispatch(channel, payload)
    })
  }
}
