import { contextBridge, ipcRenderer } from 'electron'
import { isCommand } from '../shared/commands'
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
  platform: process.platform,
  commands: {
    on: (listener) => {
      // Only the names of known commands reach the page, never the event.
      const forward = (_event: unknown, name: unknown) => {
        if (isCommand(name)) listener(name)
      }
      ipcRenderer.on('command', forward)
      return () => {
        ipcRenderer.off('command', forward)
      }
    },
  },
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
    drop: (name, bytes) => invoke('import:drop', { name, bytes }),
    preview: (request) => invoke('import:preview', request),
    commit: (request, selected) =>
      invoke('import:commit', { ...request, selected }),
    discard: (id) => invoke('import:discard', { id }),
    batches: () => invoke('import:batches', undefined),
    undo: (batchId) => invoke('import:undo', { id: batchId }),
  },
  rules: {
    list: () => invoke('rules:list', undefined),
    create: (fields) => invoke('rules:create', fields),
    update: (fields) => invoke('rules:update', fields),
    delete: (id) => invoke('rules:delete', { id }),
    move: (id, offset) => invoke('rules:move', { id, offset }),
    reach: (rule) => invoke('rules:reach', rule),
    suggest: (transactionId) => invoke('rules:suggest', { id: transactionId }),
    decline: (pattern) => invoke('rules:decline', { pattern }),
  },
  budgets: {
    month: (month) => invoke('budgets:month', { month }),
    set: (categoryId, month, amountCents) =>
      invoke('budgets:set', { categoryId, month, amountCents }),
  },
  reports: {
    month: (month, currency) => invoke('reports:month', { month, currency }),
    trend: (categoryId, month, currency) =>
      invoke('reports:trend', { categoryId, month, currency }),
  },
  backup: {
    save: (password) => invoke('backup:save', { password }),
  },
  restore: {
    open: () => invoke('restore:open', undefined),
    check: (password) => invoke('restore:check', { password }),
    commit: (currentPassword) => invoke('restore:commit', { currentPassword }),
    discard: () => invoke('restore:discard', undefined),
  },
  settings: {
    get: () => invoke('settings:get', undefined),
    update: (changes) => invoke('settings:update', changes),
  },
  export: {
    save: (month, currency, format) =>
      invoke('export:save', { month, currency, format }),
  },
  transfers: {
    possible: () => invoke('transfers:possible', undefined),
    count: () => invoke('transfers:count', undefined),
    choices: (transactionId) =>
      invoke('transfers:choices', { id: transactionId }),
    link: (transactionId, otherId) =>
      invoke('transfers:link', { id: transactionId, otherId }),
    unlink: (transactionId) =>
      invoke('transfers:unlink', { id: transactionId }),
    reject: (outId, inId) => invoke('transfers:reject', { outId, inId }),
  },
}

contextBridge.exposeInMainWorld('ledger', api)
