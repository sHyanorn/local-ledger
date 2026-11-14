import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Where the app keeps its data when nothing overrides it: the packaged app
 * under the package name, which Electron uses as package.json has no
 * product name, and a development build in a directory of its own.
 */
export function appUserDataDirs(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string[] {
  const appData =
    platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : platform === 'win32'
        ? (env.APPDATA ?? join(home, 'AppData', 'Roaming'))
        : (env.XDG_CONFIG_HOME ?? join(home, '.config'))
  return ['local-ledger', 'local-ledger-dev'].map((name) => join(appData, name))
}

/**
 * Whether `dir` is one of the app's own data directories or inside one.
 * macOS and Windows file systems ignore case by default, so names compare
 * without it there.
 */
export function isAppUserData(
  dir: string,
  dirs = appUserDataDirs(),
  platform: NodeJS.Platform = process.platform,
): boolean {
  const fold = (path: string) =>
    platform === 'linux' ? resolve(path) : resolve(path).toLowerCase()
  return dirs.some((appDir) => {
    const path = relative(fold(appDir), fold(dir))
    return !isAbsolute(path) && path.split(sep)[0] !== '..'
  })
}
