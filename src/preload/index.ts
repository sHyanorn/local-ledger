import { contextBridge } from 'electron'
import type { LedgerApi } from '../shared/api'

declare const __APP_VERSION__: string

const api: LedgerApi = Object.freeze({ version: __APP_VERSION__ })

contextBridge.exposeInMainWorld('ledger', api)
