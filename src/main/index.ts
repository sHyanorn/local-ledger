import { app } from 'electron'
import { startApp } from './app'
import { refusedSwitches } from './security'
import { isolateUserData, SELF_TEST_SWITCH } from './self-test'

const refused = refusedSwitches(
  (name) => app.commandLine.hasSwitch(name),
  app.isPackaged,
)
if (refused.length > 0) {
  console.error(`Refusing to start with --${refused.join(', --')}.`)
  app.exit(1)
} else {
  if (app.commandLine.hasSwitch(SELF_TEST_SWITCH)) isolateUserData()
  // One process per user data directory, so one process per vault.
  if (app.requestSingleInstanceLock()) startApp()
  else app.quit()
}
