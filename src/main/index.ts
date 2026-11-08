import { join } from 'node:path'
import { app, BrowserWindow, session } from 'electron'
import { hardenApp, hardenSession } from './hardening'
import { registerAppScheme, serveAppScheme } from './protocol'
import { APP_ORIGIN, windowWebPreferences } from './security'

// Refuse to start without the Chromium sandbox. This reads the switch, never sets it.
const sandboxOff = app.commandLine.hasSwitch('no-sandbox') // sandbox-check: allow
if (sandboxOff) {
  console.error(
    'Local Ledger does not run with the Chromium sandbox turned off.',
  )
  app.exit(1)
}

const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
const devOrigin = devUrl === undefined ? undefined : new URL(devUrl).origin

registerAppScheme()
hardenApp()

function createWindow(): void {
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
  void window.loadURL(devUrl ?? `${APP_ORIGIN}/index.html`)
}

void app.whenReady().then(() => {
  hardenSession(session.defaultSession, devOrigin)
  serveAppScheme(join(__dirname, '../renderer'))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
