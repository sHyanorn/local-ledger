import { app } from 'electron'
import type { Session } from 'electron'
import { isAllowedRequest } from './security'

/** Must run before the app is ready. */
export function hardenApp(devOrigin?: string): void {
  app.enableSandbox()
  // Hardens every session, the default one included, as soon as it exists.
  app.on('session-created', (session) => hardenSession(session, devOrigin))
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.on('will-redirect', (event) => event.preventDefault())
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

export function hardenSession(session: Session, devOrigin?: string): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  session.setPermissionCheckHandler(() => false)
  session.setDevicePermissionHandler(() => false)
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  // With no language, Chromium has no dictionary to download from its CDN.
  session.setSpellCheckerLanguages([])
  session.setSpellCheckerEnabled(false)
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, devOrigin) })
  })
}
