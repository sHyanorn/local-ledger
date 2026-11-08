/// <reference types="vite/client" />

import type { LedgerApi } from '../../shared/api'

declare global {
  interface Window {
    readonly ledger: LedgerApi
  }
}
