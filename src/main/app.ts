import { join } from 'node:path'
import { app, powerMonitor, shell } from 'electron'
import { IDLE_LIMIT_SECONDS, watchForLock } from './auto-lock'
import { getSettings } from './ledger/settings'
import { hardenApp } from './hardening'
import { handleBackup } from './backup/handlers'
import { handleExport } from './export/handlers'
import { handleImport } from './import/handlers'
import { ipcHandlers } from './ipc'
import { handleLedger } from './ledger/handlers'
import { RELEASES_URL, setMenu } from './menu'
import { registerAppScheme, serveAppScheme } from './protocol'
import { APP_ORIGIN, windowWebPreferences } from './security'
import { runSelfTest, SELF_TEST_SWITCH } from './self-test'
import { deriveInWorker } from './vault/derive-in-worker'
import { Vault } from './vault/vault'
import { AppWindow } from './window'
import type { Notice } from '../shared/ipc'

export function startApp(): void {
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  const devOrigin = devUrl === undefined ? undefined : new URL(devUrl).origin
  const pageUrl = devUrl ?? `${APP_ORIGIN}/index.html`

  registerAppScheme()
  hardenApp(devOrigin)

  void app.whenReady().then(() => {
    serveAppScheme(join(__dirname, '../renderer'))
    const handle = ipcHandlers(devOrigin)
    const vault = new Vault(app.getPath('userData'), {
      derive: deriveInWorker,
    })

    handle('vault:status', () => vault.state)
    handle('vault:create', ({ password }) => vault.create(password))
    handle('vault:unlock', ({ password }) => vault.unlock(password))
    // Shown once by the page that replaces the one that changed the
    // password; gone when the vault locks.
    let notice: Notice | null = null
    handle('vault:change-password', async ({ current, next }) => {
      const result = await vault.changePassword(current, next)
      if (result.ok) notice = 'password-changed'
      return result
    })
    handle('vault:take-notice', () => {
      const taken = notice
      notice = null
      return taken
    })
    handleLedger(vault, handle)

    const webPreferences = windowWebPreferences(
      join(__dirname, '../preload/index.js'),
      app.isPackaged,
    )
    let window: AppWindow | null = null
    const open = () => {
      window = new AppWindow(pageUrl, webPreferences)
      // Closing the window locks the vault; on macOS the app stays running.
      window.window.on('closed', () => {
        window = null
        backups.forget()
        vault.lock()
      })
    }
    open()
    handleImport(vault, () => window?.window ?? null, handle)
    handleExport(vault, () => window?.window ?? null, handle)
    const backups = handleBackup(vault, () => window?.window ?? null, handle)
    vault.onChange(() => {
      if (!vault.unlocked) notice = null
      window?.replaceView()
    })
    // Also replaces a page that was already locked, so a password typed
    // but not submitted does not survive a lock.
    const lock = () => {
      // A backup chosen for a restore goes too, also at setup, where there
      // is no vault to lock and so no change for it to hear of.
      backups.forget()
      if (!vault.lock()) window?.replaceView()
    }
    handle('vault:lock', lock)
    setMenu({
      lock,
      command: (name) => {
        if (vault.unlocked) window?.contents?.send('command', name)
      },
      openReleases: () => void shell.openExternal(RELEASES_URL),
      packaged: app.isPackaged,
    })
    // The self-test runs on machines nobody is using, where any idle limit
    // may already be past; screen lock and sleep still lock.
    const selfTest = app.commandLine.hasSwitch(SELF_TEST_SWITCH)
    watchForLock(powerMonitor, lock, {
      // The vault's own setting while it is open; locking again is harmless.
      idleLimit: () => {
        if (selfTest) return Number.POSITIVE_INFINITY
        try {
          return getSettings(vault.database()).idleLockMinutes * 60
        } catch {
          return IDLE_LIMIT_SECONDS
        }
      },
    })

    app.on('second-instance', () => {
      if (!window) return open()
      if (window.window.isMinimized()) window.window.restore()
      window.window.show()
      window.window.focus()
    })
    app.on('activate', () => {
      if (!window) open()
    })
    if (selfTest) {
      void runSelfTest(vault, () => window?.contents, pageUrl)
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
