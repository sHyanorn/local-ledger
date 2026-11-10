// Saving a backup or an export: a write that fails leaves the file that was
// already there as it was.
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const faults = vi.hoisted(() => ({
  /** Half the bytes land, then the write fails, as on a disk that fills up. */
  failWrite: false,
  /** Error codes the next renames fail with, in order. */
  renames: [] as string[],
  renamed: 0,
  /** What the next temporary name is drawn from, in place of random bytes. */
  suffix: null as Buffer | null,
}))
vi.mock('node:crypto', async (original) => {
  const real = await original<typeof import('node:crypto')>()
  return {
    ...real,
    randomBytes: (size: number) => faults.suffix ?? real.randomBytes(size),
  }
})
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>()
  const failing = (code: string) => Object.assign(new Error(code), { code })
  return {
    ...real,
    open: async (...args: Parameters<typeof real.open>) => {
      const handle = await real.open(...args)
      if (!faults.failWrite) return handle
      const writeFile = handle.writeFile.bind(handle)
      handle.writeFile = (async (data: Uint8Array) => {
        await writeFile(data.subarray(0, data.length >> 1))
        throw failing('ENOSPC')
      }) as typeof handle.writeFile
      return handle
    },
    rename: async (...args: Parameters<typeof real.rename>) => {
      faults.renamed++
      const code = faults.renames.shift()
      if (code) throw failing(code)
      return real.rename(...args)
    },
  }
})
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }))

import { writeFailure, writeOwnerOnly } from '../../src/main/owner-only'

const OLD = 'the old fake backup'
const NEW = Buffer.from('a newer, longer fake backup')
let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-write-'))
  path = join(dir, 'fake.llbackup')
  faults.failWrite = false
  faults.renames = []
  faults.renamed = 0
  faults.suffix = null
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})
const onWindows = () =>
  vi.stubGlobal('process', { ...process, platform: 'win32' })

describe('writeOwnerOnly', () => {
  it('writes a new file, owner-only', async () => {
    await writeOwnerOnly(path, NEW)
    expect(readFileSync(path)).toEqual(NEW)
    expect(readdirSync(dir)).toEqual(['fake.llbackup'])
    if (process.platform !== 'win32')
      expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('replaces a file, owner-only whatever its mode was', async () => {
    writeFileSync(path, OLD, { mode: 0o644 })
    await writeOwnerOnly(path, NEW)
    expect(readFileSync(path)).toEqual(NEW)
    expect(readdirSync(dir)).toEqual(['fake.llbackup'])
    if (process.platform !== 'win32')
      expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('leaves the file that was there when the write fails midway', async () => {
    writeFileSync(path, OLD)
    faults.failWrite = true
    await expect(writeOwnerOnly(path, NEW)).rejects.toThrow('ENOSPC')
    expect(readFileSync(path, 'utf8')).toBe(OLD)
    expect(readdirSync(dir)).toEqual(['fake.llbackup'])
    expect(writeFailure(path)).toBe('unwritable-kept')
  })

  it('leaves nothing when a new file fails midway', async () => {
    faults.failWrite = true
    await expect(writeOwnerOnly(path, NEW)).rejects.toThrow('ENOSPC')
    expect(readdirSync(dir)).toEqual([])
    expect(writeFailure(path)).toBe('unwritable')
  })

  it.skipIf(process.platform === 'win32')(
    'never writes through a link left under its temporary name',
    async () => {
      faults.suffix = Buffer.from('fake01')
      const other = join(dir, 'fake-other-file')
      writeFileSync(other, OLD)
      symlinkSync(other, `${path}.${faults.suffix.toString('hex')}.tmp`)
      await expect(writeOwnerOnly(path, NEW)).rejects.toThrow('EEXIST')
      expect(readFileSync(other, 'utf8')).toBe(OLD)
      expect(readdirSync(dir)).toHaveLength(2)
    },
  )

  it('fails, touching nothing, when its temporary name is taken', async () => {
    faults.suffix = Buffer.from('fake01')
    const taken = `${path}.${faults.suffix.toString('hex')}.tmp`
    writeFileSync(path, OLD)
    writeFileSync(taken, 'not this save’s file')
    await expect(writeOwnerOnly(path, NEW)).rejects.toThrow('EEXIST')
    expect(readFileSync(path, 'utf8')).toBe(OLD)
    expect(readFileSync(taken, 'utf8')).toBe('not this save’s file')
  })

  it.skipIf(process.platform === 'win32')(
    'writes through a link instead of replacing it',
    async () => {
      const real = join(dir, 'real.llbackup')
      writeFileSync(real, OLD)
      symlinkSync(real, path)
      await writeOwnerOnly(path, NEW)
      expect(lstatSync(path).isSymbolicLink()).toBe(true)
      expect(readFileSync(real)).toEqual(NEW)
    },
  )

  it('on Windows, tries again while another program holds the file', async () => {
    writeFileSync(path, OLD)
    onWindows()
    faults.renames = ['EPERM', 'EBUSY', 'EACCES']
    await writeOwnerOnly(path, NEW)
    expect(faults.renamed).toBe(4)
    expect(readFileSync(path)).toEqual(NEW)
  })

  it('on Windows, gives up after a while and leaves the file that was there', async () => {
    writeFileSync(path, OLD)
    onWindows()
    faults.renames = Array.from({ length: 20 }, () => 'EPERM')
    await expect(writeOwnerOnly(path, NEW)).rejects.toThrow('EPERM')
    expect(faults.renamed).toBe(6)
    expect(readFileSync(path, 'utf8')).toBe(OLD)
    expect(readdirSync(dir)).toEqual(['fake.llbackup'])
  })

  it('does not try again elsewhere, or for another failure', async () => {
    writeFileSync(path, OLD)
    faults.renames = ['EPERM']
    await expect(writeOwnerOnly(path, NEW)).rejects.toThrow('EPERM')
    expect(faults.renamed).toBe(1)
    onWindows()
    faults.renames = ['ENOSPC']
    await expect(writeOwnerOnly(path, NEW)).rejects.toThrow('ENOSPC')
    expect(faults.renamed).toBe(2)
    expect(readFileSync(path, 'utf8')).toBe(OLD)
  })
})
