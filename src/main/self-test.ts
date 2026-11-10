// `--self-test` checks that the page renders and that the vault works end to
// end (key derivation in its worker, the sealed key, the encrypted database
// through the bundled SQLCipher module), then exits 0 or 1. CI runs it on
// the packaged app, which no test driver can reach. It works in a temporary
// user data directory with a throwaway password and prints no key material.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { app } from 'electron'
import type { WebContents } from 'electron'
import { databaseName } from './vault/layout'
import { Vault } from './vault/vault'

export const SELF_TEST_SWITCH = 'self-test'

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

/** Waits for the current page to load the app and render into #root. */
async function checkPage(
  contents: () => WebContents | undefined,
  url: string,
  what: string,
): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const page = contents()
    if (page && !page.isLoading() && page.getURL() === url) {
      const children: unknown = await page.executeJavaScript(
        "document.getElementById('root')?.childElementCount ?? 0",
      )
      if (typeof children === 'number' && children > 0) {
        check(true, `the window renders ${what}`)
        return
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  check(false, `the window renders ${what}`)
}

function plainSqliteFails(file: string): boolean {
  const db = new Database(file, { readonly: true })
  try {
    db.pragma('user_version')
    return false
  } catch {
    return true
  } finally {
    db.close()
  }
}

async function checkVault(
  vault: Vault,
  contents: () => WebContents | undefined,
  url: string,
): Promise<void> {
  check(vault.state === 'new', 'a new vault starts empty')
  await checkPage(contents, url, 'the setup page')
  const firstPage = contents()

  check((await vault.create(PASSWORD)).ok, 'the vault is created')
  check(vault.state === 'unlocked', 'a new vault is unlocked')
  check(contents() !== firstPage, 'unlocking replaces the page')
  await checkPage(contents, url, 'the unlocked page')
  const db = vault.database()
  console.log(
    `sqlite ${db.prepare('SELECT sqlite_version()').pluck().get()}, ` +
      `cipher ${db.pragma('cipher', { simple: true })}`,
  )
  check(
    db.prepare('SELECT count(*) FROM accounts').pluck().get() === 0,
    'the database holds the schema',
  )

  vault.lock()
  check(vault.state === 'locked' && !db.open, 'the vault locks')
  const file = join(vault.dir, databaseName(1))
  check(
    readFileSync(file).subarray(0, 16).toString('latin1') !==
      'SQLite format 3\0',
    'the database file has no plaintext header',
  )
  check(plainSqliteFails(file), 'the database does not open without the key')

  const wrong = await vault.unlock(`${PASSWORD} but wrong`)
  check(
    !wrong.ok && wrong.reason === 'wrong-password',
    'a wrong password fails',
  )
  check((await vault.unlock(PASSWORD)).ok, 'the right password unlocks')
  vault.lock()
}

export async function runSelfTest(
  vault: Vault,
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
