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
    changePassword: (current, next) =>
      invoke('vault:change-password', { current, next }),
  },
  accounts: {
    list: () => invoke('accounts:list', undefined),
    create: (fields) => invoke('accounts:create', fields),
    update: (fields) => invoke('accounts:update', fields),
    delete: (id) => invoke('accounts:delete', { id }),
  },
  categories: {
    list: () => invoke('categories:list', undefined),
    create: (fields) => invoke('categories:create', fields),
    update: (fields) => invoke('categories:update', fields),
    delete: (id) => invoke('categories:delete', { id }),
  },
  transactions: {
    page: (filter, limit, after) =>
      invoke('transactions:page', {
        filter,
        limit,
        ...(after ? { after } : {}),
      }),
    totals: (filter) => invoke('transactions:totals', filter),
    create: (fields) => invoke('transactions:create', fields),
    update: (fields) => invoke('transactions:update', fields),
    setCategory: (id, categoryId) =>
      invoke('transactions:set-category', { id, categoryId }),
    delete: (id) => invoke('transactions:delete', { id }),
  },
  imports: {
    open: () => invoke('import:open', undefined),
    preview: (request) => invoke('import:preview', request),
    commit: (request, selected) =>
      invoke('import:commit', { ...request, selected }),
    discard: (id) => invoke('import:discard', { id }),
    batches: () => invoke('import:batches', undefined),
    undo: (batchId) => invoke('import:undo', { id: batchId }),
  },
}

contextBridge.exposeInMainWorld('ledger', api)
