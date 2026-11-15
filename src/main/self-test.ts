// `--self-test` checks that the page renders and that the vault works end to
// end (key derivation in its worker, the sealed key, the encrypted database
// through the bundled SQLCipher module), then exits 0 or 1. CI runs it on
// the packaged app, which no test driver can reach. It works in a temporary
// user data directory with a throwaway password and prints no key material.
// It reaches the vault through its channels, as a page does, and through
// the probe of the open database.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { WebContents } from 'electron'
import type { Channel, Payload, Results } from '../shared/ipc'
import type { VaultProbe } from './vault/probe'

export const SELF_TEST_SWITCH = 'self-test'

/** The vault as the self-test reaches it. */
export interface SelfTestVault {
  /** The user data directory the vault lives in. */
  root: string
  /** A call on a channel, as a page makes it. */
  call<C extends Channel>(channel: C, payload: Payload<C>): Promise<Results[C]>
  /** Locks as the menu does. */
  lock(): void
  probe(): Promise<VaultProbe>
}

const PREFIX = 'local-ledger-self-test-'
const PASSWORD = 'self-test passphrase, not a secret'
let userData: string | undefined

/**
 * Points the user data directory, and with it the Chromium profile, at a
 * new temporary directory, so the self-test never reads or writes the
 * user's data. Must run before the app is ready.
 */
export function isolateUserData(): void {
  const temp = app.getPath('temp')
  // Chromium writes its profile on the way out, after the self-test has
  // removed the directory, so each run clears what the last one left.
  for (const name of readdirSync(temp)) {
    if (name.startsWith(PREFIX)) remove(join(temp, name))
  }
  userData = mkdtempSync(join(temp, PREFIX))
  app.setPath('userData', userData)
}

function remove(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    // Best effort: another run, or the profile, may still hold files.
  }
}

function exit(code: number): void {
  if (userData) remove(userData)
  app.exit(code)
}

function check(ok: boolean, step: string): void {
  if (!ok) throw new Error(step)
  console.log(`ok: ${step}`)
}

/** Checks a step that may take a few seconds to come true. */
async function waitFor(
  test: () => boolean | Promise<boolean>,
  step: string,
): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (await test()) return check(true, step)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  check(false, step)
}

/** Waits for the current page to load the app and render into #root. */
const checkPage = (
  contents: () => WebContents | undefined,
  url: string,
  what: string,
) =>
  waitFor(async () => {
    const page = contents()
    if (!page || page.isLoading() || page.getURL() !== url) return false
    const children: unknown = await page.executeJavaScript(
      "document.getElementById('root')?.childElementCount ?? 0",
    )
    return typeof children === 'number' && children > 0
  }, `the window renders ${what}`)

async function checkVault(
  vault: SelfTestVault,
  contents: () => WebContents | undefined,
  url: string,
): Promise<void> {
  const status = () => vault.call('vault:status', undefined)
  check((await status()) === 'new', 'a new vault starts empty')
  await checkPage(contents, url, 'the setup page')
  const firstPage = contents()

  const created = await vault.call('vault:create', { password: PASSWORD })
  check(created.ok, 'the vault is created')
  check((await status()) === 'unlocked', 'a new vault is unlocked')
  await waitFor(() => contents() !== firstPage, 'unlocking replaces the page')
  await checkPage(contents, url, 'the unlocked page')
  const probe = await vault.probe()
  console.log(`sqlite ${probe.sqlite}, cipher ${probe.cipher}`)
  const accounts = await vault.call('accounts:list', undefined)
  check(accounts.length === 0, 'the database holds the schema')
  check(!probe.plaintextHeader, 'the database file has no plaintext header')
  check(!probe.opensWithoutKey, 'the database does not open without the key')

  vault.lock()
  check((await status()) === 'locked', 'the vault locks')
  const wrong = await vault.call('vault:unlock', {
    password: `${PASSWORD} but wrong`,
  })
  check(
    !wrong.ok && wrong.reason === 'wrong-password',
    'a wrong password fails',
  )
  const right = await vault.call('vault:unlock', { password: PASSWORD })
  check(right.ok, 'the right password unlocks')
  vault.lock()
}

export async function runSelfTest(
  vault: SelfTestVault,
  contents: () => WebContents | undefined,
  url: string,
): Promise<void> {
  try {
    console.log(
      `electron ${process.versions.electron}, ${process.platform}-${process.arch}, ` +
        `packaged ${app.isPackaged}`,
    )
    check(
      app.getPath('userData') === userData && vault.root === userData,
      'the user data directory is a temporary one',
    )
    await checkVault(vault, contents, url)
    console.log('self-test passed')
    exit(0)
  } catch (error) {
    console.error(
      `self-test failed: ${error instanceof Error ? error.message : error}`,
    )
    exit(1)
  }
}
