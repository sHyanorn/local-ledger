import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { hardenApp } from './hardening'
import { registerAppScheme, serveAppScheme } from './protocol'
import { APP_ORIGIN, refusedSwitches, windowWebPreferences } from './security'
import { runSelfTest, SELF_TEST_SWITCH } from './self-test'

const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
const devOrigin = devUrl === undefined ? undefined : new URL(devUrl).origin
const pageUrl = devUrl ?? `${APP_ORIGIN}/index.html`

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    webPreferences: windowWebPreferences(
      join(__dirname, '../preload/index.js'),
      app.isPackaged,
    ),
  })
  window.once('ready-to-show', () => window.show())
  void window.loadURL(pageUrl)
  return window
}

function start(): void {
  registerAppScheme()
  hardenApp(devOrigin)

  void app.whenReady().then(() => {
    serveAppScheme(join(__dirname, '../renderer'))
    const window = createWindow()
    if (app.commandLine.hasSwitch(SELF_TEST_SWITCH)) {
      void runSelfTest(window, pageUrl)
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

const refused = refusedSwitches(
  (name) => app.commandLine.hasSwitch(name),
  app.isPackaged,
)
if (refused.length > 0) {
  console.error(`Refusing to start with --${refused.join(', --')}.`)
  app.exit(1)
} else {
  start()
}
