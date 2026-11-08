import { contextBridge, ipcRenderer } from 'electron'
import type { LedgerApi } from '../shared/api'
import type { Channel, Payload, Results } from '../shared/ipc'

declare const __APP_VERSION__: string

const invoke = <C extends Channel>(
  channel: C,
  payload: Payload<C>,
): Promise<Results[C]> => ipcRenderer.invoke(channel, payload)

// contextBridge hands the page a frozen copy of this object.
const api: LedgerApi = {
  version: __APP_VERSION__,
  vault: {
    status: () => invoke('vault:status', undefined),
    create: (password) => invoke('vault:create', { password }),
    unlock: (password) => invoke('vault:unlock', { password }),
    lock: () => invoke('vault:lock', undefined),
  },
}

contextBridge.exposeInMainWorld('ledger', api)
