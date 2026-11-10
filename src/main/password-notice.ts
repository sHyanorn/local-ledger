// Changing the password, and the notice about copies of the old one. The
// page that replaces the one that changed the password shows it once; it
// is gone when the vault locks.
import type { Handle } from './ipc'
import type { Vault } from './vault/vault'
import type { Notice } from '../shared/ipc'

export function handlePasswordChange(vault: Vault, handle: Handle): void {
  let notice: Notice | null = null
  handle('vault:change-password', async ({ current, next }) => {
    const result = await vault.changePassword(current, next)
    // A change that stands but could not reopen the database leaves the
    // vault locked, and the lock has already been announced.
    if (result.ok && vault.unlocked) notice = 'password-changed'
    return result
  })
  handle('vault:take-notice', () => {
    const taken = notice
    notice = null
    return taken
  })
  vault.onChange(() => {
    if (!vault.unlocked) notice = null
  })
}
