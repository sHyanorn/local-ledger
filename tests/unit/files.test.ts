import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileAtomic } from '../../src/main/vault/files'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-files-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('writeFileAtomic', () => {
  it('replaces the file and leaves no temporary file', () => {
    const file = join(dir, 'vault.json')
    writeFileSync(file, 'old')
    writeFileAtomic(file, 'new')
    expect(readFileSync(file, 'utf8')).toBe('new')
    expect(() => statSync(`${file}.tmp`)).toThrow()
  })

  it.skipIf(process.platform === 'win32')(
    'makes the file readable by its owner only',
    () => {
      const file = join(dir, 'vault.json')
      writeFileAtomic(file, 'new')
      expect(statSync(file).mode & 0o777).toBe(0o600)
    },
  )

  it('keeps the old content when interrupted before the rename', () => {
    const file = join(dir, 'vault.json')
    writeFileSync(file, 'old')
    expect(() =>
      writeFileAtomic(file, 'new', () => {
        throw new Error('crash')
      }),
    ).toThrow('crash')
    expect(readFileSync(file, 'utf8')).toBe('old')
    writeFileAtomic(file, 'newer')
    expect(readFileSync(file, 'utf8')).toBe('newer')
  })
})
