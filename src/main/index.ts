import { app } from 'electron'
import { startApp } from './app'
import { devUserData, refusedSwitches } from './security'
import { isolateUserData, SELF_TEST_SWITCH } from './self-test'

const hasSwitch = (name: string) => app.commandLine.hasSwitch(name)
const refused = refusedSwitches(hasSwitch, app.isPackaged)
if (refused.length > 0) {
  console.error(`Refusing to start with --${refused.join(', --')}.`)
  app.exit(1)
} else {
  if (hasSwitch(SELF_TEST_SWITCH)) isolateUserData()
  else {
    const userData = devUserData(
      hasSwitch,
      app.isPackaged,
      app.getPath('appData'),
    )
    if (userData) app.setPath('userData', userData)
  }
  // One process per user data directory, so one process per vault.
  if (app.requestSingleInstanceLock()) startApp()
  else app.quit()
}
