import { ipcMain, MessageChannelMain } from 'electron'
import type {
  IpcMainEvent,
  IpcMainInvokeEvent,
  MessagePortMain,
} from 'electron'
import { channels } from '../shared/ipc'
import { isTrustedSender } from './security'

/**
 * What the main process answers on ipcMain, only for this app's frames and,
 * while developing, the dev server's: a lock, and a port to the vault host
 * for each page, which its preload asks for once.
 */
export function listenToPages(
  devOrigin: string | undefined,
  {
    lock,
    connect,
  }: { lock: () => void; connect: (port: MessagePortMain) => void },
): void {
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    isTrustedSender(event.senderFrame?.origin, devOrigin)
  ipcMain.handle('vault:lock', (event, payload: unknown) => {
    if (!trusted(event)) throw new Error('forbidden')
    if (!channels['vault:lock'].safeParse(payload).success)
      throw new Error('invalid-argument')
    lock()
  })
  ipcMain.on('vault:port', (event) => {
    const frame = event.senderFrame
    if (!frame || !trusted(event)) return
    const { port1, port2 } = new MessageChannelMain()
    connect(port2)
    frame.postMessage('vault:port', null, [port1])
  })
}
