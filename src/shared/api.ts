import type { Results, VaultState } from './ipc'

/** The API that preload exposes to the renderer as `window.ledger`. */
export interface LedgerApi {
  readonly version: string
  readonly vault: {
    status(): Promise<VaultState>
    create(password: string): Promise<Results['vault:create']>
    unlock(password: string): Promise<Results['vault:unlock']>
    lock(): Promise<void>
  }
}
