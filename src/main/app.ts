import { join } from 'node:path'
import { app, powerMonitor, shell } from 'electron'
import type { IdleLockMinutes } from '../shared/settings'
import { IDLE_LIMIT_SECONDS, watchForLock } from './auto-lock'
import { mainServices } from './dialogs'
import { hardenApp } from './hardening'
import { VaultHost } from './host-process'
import { listenToPages } from './ipc'
import { RELEASES_URL, setMenu } from './menu'
import { registerAppScheme, serveAppScheme } from './protocol'
import { APP_ORIGIN, windowWebPreferences } from './security'
import { runSelfTest, SELF_TEST_SWITCH } from './self-test'
import { exposeTestHooks } from './test-hooks'
import { AppWindow } from './window'

export function startApp(): void {
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  const devOrigin = devUrl === undefined ? undefined : new URL(devUrl).origin
  const pageUrl = devUrl ?? `${APP_ORIGIN}/index.html`

  registerAppScheme()
  hardenApp(devOrigin)

  void app.whenReady().then(() => {
    serveAppScheme(join(__dirname, '../renderer'))
    const webPreferences = windowWebPreferences(
      join(__dirname, '../preload/index.js'),
      app.isPackaged,
    )
    let window: AppWindow | null = null
    let unlocked = false
    /** The open vault's auto-lock setting. */
    let idleMinutes: IdleLockMinutes | null = null
    const host = new VaultHost({
      entry: join(__dirname, 'host.js'),
      root: app.getPath('userData'),
      services: mainServices(() => window?.window ?? null),
      testHooks: !app.isPackaged,
      onChange: (state) => {
        if (state !== 'unlocked') return lock()
        unlocked = true
        window?.replaceView()
      },
      onIdle: (minutes) => {
        idleMinutes = minutes
      },
    })
    // Every lock ends the host and replaces the page, also one that was
    // already locked, so a password typed but not submitted, or a backup
    // chosen for a restore, does not survive it.
    const lock = () => {
      unlocked = false
      idleMinutes = null
      host.lock()
      window?.replaceView()
    }
    const open = () => {
      window = new AppWindow(pageUrl, webPreferences)
      // Closing the window locks the vault; on macOS the app stays running.
      window.window.on('closed', () => {
        window = null
        lock()
      })
    }
    listenToPages(devOrigin, { lock, connect: (port) => host.connect(port) })
    open()
    if (!app.isPackaged) {
      exposeTestHooks({
        failNext: (channel) => host.failNext(channel),
        failAfterLock: (channel) => host.failAfterLock(channel),
      })
    }
    setMenu({
      lock,
      command: (name) => {
        if (unlocked) window?.contents?.send('command', name)
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
        return idleMinutes === null ? IDLE_LIMIT_SECONDS : idleMinutes * 60
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
    // The host locks and exits before the app does.
    app.on('will-quit', (event) => {
      if (!host.running) return
      event.preventDefault()
      host.lock()
      void host.ended().then(() => app.quit())
    })
    if (selfTest) {
      void runSelfTest(
        {
          root: app.getPath('userData'),
          call: (channel, payload) => host.call(channel, payload),
          lock,
          probe: async () => {
            const probe = await host.probe()
            if (!probe) throw new Error('no open vault to probe')
            return probe
          },
        },
        () => window?.contents,
        pageUrl,
      )
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
