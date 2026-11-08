import { contextBridge } from 'electron'
import type { LedgerApi } from '../shared/api'

declare const __APP_VERSION__: string

// contextBridge hands the page a frozen copy of this object.
const api: LedgerApi = { version: __APP_VERSION__ }

contextBridge.exposeInMainWorld('ledger', api)
