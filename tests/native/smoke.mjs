// Opens an encrypted database in the Electron main process, the way the app
// will: run as `electron tests/native/smoke.mjs`. Exits 0 when every step
// behaves. Uses a random throwaway key and prints no key material.
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { app } from 'electron'

/**
 * @param {string} file
 * @param {Buffer | null} key
 */
function open(file, key) {
  const db = new Database(file)
  db.pragma("cipher='sqlcipher'")
  db.pragma('legacy=4')
  if (key) db.pragma(`key="x'${key.toString('hex')}'"`)
  return db
}

/** @param {() => unknown} run */
function fails(run) {
  try {
    run()
    return false
  } catch {
    return true
  }
}

/** @param {boolean} ok @param {string} step */
function check(ok, step) {
  if (!ok) throw new Error(`failed: ${step}`)
  console.log(`ok: ${step}`)
}

function run() {
  const dir = mkdtempSync(join(app.getPath('temp'), 'ledger-smoke-'))
  const file = join(dir, 'smoke.db')
  const key = randomBytes(32)
  try {
    const db = open(file, key)
    db.exec(
      'CREATE TABLE t (id INTEGER PRIMARY KEY, amount_cents INTEGER NOT NULL)',
    )
    const insert = db.prepare('INSERT INTO t (amount_cents) VALUES (?)')
    for (const cents of [1250, -4999, 100000]) insert.run(cents)
    const { version } = /** @type {{ version: string }} */ (
      db.prepare('SELECT sqlite_version() AS version').get()
    )
    console.log(
      `electron ${process.versions.electron}, node ${process.versions.node}, ` +
        `${process.platform}-${process.arch}, sqlite ${version}, ` +
        `cipher ${db.pragma('cipher', { simple: true })}`,
    )
    db.close()

    const header = readFileSync(file).subarray(0, 16).toString('latin1')
    check(
      header !== 'SQLite format 3\0',
      'the file has no plaintext SQLite header',
    )

    const count = 'SELECT count(*) AS n FROM t'
    const noKey = open(file, null)
    check(
      fails(() => noKey.prepare(count).get()),
      'the database does not open without a key',
    )
    noKey.close()

    const wrong = open(file, randomBytes(32))
    check(
      fails(() => wrong.prepare(count).get()),
      'the database does not open with a wrong key',
    )
    wrong.close()

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

void app.whenReady().then(() => {
  try {
    run()
    app.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    app.exit(1)
  }
})
