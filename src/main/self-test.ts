// `--self-test` checks that the window renders and that the bundled SQLCipher
// module opens an encrypted database, then exits 0 or 1. CI runs it on the
// packaged app, which no test driver can reach. It uses a random throwaway
// key and prints no key material.
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'

export const SELF_TEST_SWITCH = 'self-test'

function check(ok: boolean, step: string): void {
  if (!ok) throw new Error(step)
  console.log(`ok: ${step}`)
}

function fails(run: () => unknown): boolean {
  try {
    run()
    return false
  } catch {
    return true
  }
}

async function checkWindow(window: BrowserWindow, url: string): Promise<void> {
  const contents = window.webContents
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (!contents.isLoading() && contents.getURL() === url) {
      const children: unknown = await contents.executeJavaScript(
        "document.getElementById('root')?.childElementCount ?? 0",
      )
      if (typeof children === 'number' && children > 0) {
        check(true, `the window renders ${url}`)
        return
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  check(false, `the window renders ${url}`)
}

function open(file: string, key: Buffer | null): Database.Database {
  const db = new Database(file)
  db.pragma("cipher='sqlcipher'")
  db.pragma('legacy=4')
  if (key) db.pragma(`key="x'${key.toString('hex')}'"`)
  return db
}

function checkDatabase(): void {
  const dir = mkdtempSync(join(app.getPath('temp'), 'ledger-self-test-'))
  const file = join(dir, 'self-test.db')
  const key = randomBytes(32)
  try {
    const db = open(file, key)
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, amount_cents INTEGER)')
    const insert = db.prepare('INSERT INTO t (amount_cents) VALUES (?)')
    for (const cents of [1250, -4999, 100000]) insert.run(cents)
    console.log(
      `sqlite ${db.prepare('SELECT sqlite_version()').pluck().get()}, ` +
        `cipher ${db.pragma('cipher', { simple: true })}`,
    )
    db.close()

    const header = readFileSync(file).subarray(0, 16).toString('latin1')
    check(header !== 'SQLite format 3\0', 'the file has no plaintext header')

    const count = 'SELECT count(*) FROM t'
    for (const [label, wrongKey] of [
      ['without a key', null],
      ['with a wrong key', randomBytes(32)],
    ] as const) {
      const other = open(file, wrongKey)
      check(
        fails(() => other.prepare(count).get()),
        `the database does not open ${label}`,
      )
      other.close()
    }

    const right = open(file, key)
    const rows = right
      .prepare('SELECT amount_cents FROM t ORDER BY id')
      .pluck()
      .all()
    check(
      JSON.stringify(rows) === '[1250,-4999,100000]',
      'the right key reads the rows back',
    )
    right.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function runSelfTest(
  window: BrowserWindow,
  url: string,
): Promise<void> {
  try {
    console.log(
      `electron ${process.versions.electron}, ${process.platform}-${process.arch}, ` +
        `packaged ${app.isPackaged}`,
    )
    await checkWindow(window, url)
    checkDatabase()
    console.log('self-test passed')
    app.exit(0)
  } catch (error) {
    console.error(
      `self-test failed: ${error instanceof Error ? error.message : error}`,
    )
    app.exit(1)
  }
}
