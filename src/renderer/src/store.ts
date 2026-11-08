import { create } from 'zustand'
import type { VaultState } from '../../shared/ipc'

type Notice =
  'wrong-password' | 'newer' | 'damaged' | 'exists' | 'no-vault' | null

interface VaultStore {
  state: VaultState | 'loading'
  busy: boolean
  notice: Notice
  load(): Promise<void>
  create(password: string): Promise<void>
  unlock(password: string): Promise<void>
  lock(): Promise<void>
}

/**
 * The page lives only for one vault state: when the vault opens or locks,
 * the main process replaces it with a fresh page in a new process.
 */
export const useVault = create<VaultStore>((set) => ({
  state: 'loading',
  busy: false,
  notice: null,
  load: async () => set({ state: await window.ledger.vault.status() }),
  create: async (password) => {
    set({ busy: true, notice: null })
    const result = await window.ledger.vault.create(password)
    set({ busy: false, notice: result.ok ? null : result.reason })
  },
  unlock: async (password) => {
    set({ busy: true, notice: null })
    const result = await window.ledger.vault.unlock(password)
    if (result.ok) return
    set({
      busy: false,
      notice: result.reason,
      ...(result.reason === 'damaged' ? { state: 'damaged' as const } : {}),
    })
  },
  lock: () => window.ledger.vault.lock(),
}))
