import { create } from 'zustand'
import type { Results, VaultState } from '../../shared/ipc'
import { PASSWORD_MAX, passwordLength } from '../../shared/password'

type Reason<C extends 'vault:create' | 'vault:unlock'> = Extract<
  Results[C],
  { ok: false }
>['reason']
/** A refusal from the main process, or 'failed' when the call itself failed. */
type Notice = Reason<'vault:create'> | Reason<'vault:unlock'> | 'failed' | null

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
    try {
      const result = await window.ledger.vault.create(password)
      set({ busy: false, notice: result.ok ? null : result.reason })
    } catch {
      set({ busy: false, notice: 'failed' })
    }
  },
  unlock: async (password) => {
    // No password that long was ever accepted.
    if (passwordLength(password) > PASSWORD_MAX) {
      return set({ notice: 'wrong-password' })
    }
    set({ busy: true, notice: null })
    try {
      const result = await window.ledger.vault.unlock(password)
      if (result.ok) return
      set({
        busy: false,
        notice: result.reason,
        ...(result.reason === 'damaged' ? { state: 'damaged' as const } : {}),
      })
    } catch {
      set({ busy: false, notice: 'failed' })
    }
  },
  lock: () => window.ledger.vault.lock(),
}))
