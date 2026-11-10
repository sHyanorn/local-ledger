import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES } from '../../src/main/import/csv'
import { readChosen } from '../../src/main/read-file'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-read-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readChosen', () => {
  it('reads a regular file', async () => {
    const path = join(dir, 'fake.csv')
    writeFileSync(path, '01/05/2026,-1.00,Fake\n')
    expect(
      Buffer.from(
        (await readChosen(path, MAX_FILE_BYTES)) as Uint8Array,
      ).toString(),
    ).toBe('01/05/2026,-1.00,Fake\n')
  })

  it('refuses a file past the limit', async () => {
    const path = join(dir, 'big.csv')
    writeFileSync(path, Buffer.alloc(MAX_FILE_BYTES + 1, 0x41))
    expect(await readChosen(path, MAX_FILE_BYTES)).toBe('too-large')
  })

  it('refuses a directory and a missing file', async () => {
    expect(await readChosen(dir, MAX_FILE_BYTES)).toBe('unreadable')
    expect(await readChosen(join(dir, 'missing.csv'), MAX_FILE_BYTES)).toBe(
      'unreadable',
    )
  })

  it.skipIf(process.platform === 'win32')(
    'refuses a pipe without waiting on it',
    async () => {
      const path = join(dir, 'pipe.csv')
      execFileSync('mkfifo', [path])
      expect(await readChosen(path, MAX_FILE_BYTES)).toBe('unreadable')
    },
    5000,
  )
})
