// A lock while a backup, restore or file choice waits on a dialog, a file
// read or a key derivation: the call fails as locked and nothing goes on.
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleBackup } from '../../src/main/backup/handlers'
import { handleImport } from '../../src/main/import/handlers'
import type { Handle } from '../../src/main/ipc'
import { createAccount } from '../../src/main/ledger/accounts'
import { deriveHere, type Derive } from '../../src/main/vault/kdf'
import { REPLACED_PREFIX } from '../../src/main/vault/layout'
import { LockedError, Vault } from '../../src/main/vault/vault'
import type { Channel, Payload, Results } from '../../src/shared/ipc'
import { FAST, NEW, OLD } from '../support/vault'

type Step = 'derive' | 'dialog' | 'read'

const held = vi.hoisted(() => {
  /** Steps the test holds: the next call to each waits until released. */
  const steps = new Map<
    string,
    { reach: () => void; reached: Promise<void>; released: Promise<void> }
  >()
  return {
    steps,
    /** Waits here if the test holds this step. */
    async at(step: string) {
      const hold = steps.get(step)
      if (!hold) return
      steps.delete(step)
      hold.reach()
      await hold.released
    },
    reads: 0,
    saves: [] as string[],
    openPath: '',
    savePath: '',
  }
})

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: async () => {
      await held.at('dialog')
      return { canceled: false, filePaths: [held.openPath] }
    },
    showSaveDialog: async () => {
      held.saves.push(held.savePath)
      await held.at('dialog')
      return { canceled: false, filePath: held.savePath }
    },
  },
}))
vi.mock('../../src/main/read-file', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/main/read-file')>()
  return {
    ...actual,
    readChosen: async (...args: Parameters<typeof actual.readChosen>) => {
      held.reads++
      await held.at('read')
      return actual.readChosen(...args)
    },
  }
})

const derive: Derive = async (...args) => {
  await held.at('derive')
  return deriveHere(...args)
}

/** Calls `call`, locks the vault once it reaches `step`, then lets it go on. */
async function lockAt<T>(step: Step, vault: Vault, call: () => Promise<T>) {
  let reach!: () => void
  let release!: () => void
  const reached = new Promise<void>((resolve) => (reach = resolve))
  const released = new Promise<void>((resolve) => (release = resolve))
  held.steps.set(step, { reach, reached, released })
  const result = call()
  await reached
  vault.lock()
  release()
  return result
}

let root: string
let vault: Vault
let call: <C extends Channel>(
  channel: C,
  payload: Payload<C>,
) => Promise<Results[C]>

/** An open vault under NEW, with a backup made under OLD beside it. */
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ledger-lock-during-'))
  const source = new Vault(join(root, 'source'), { derive, kdf: FAST })
  await source.create(OLD)
  createAccount(source.database(), {
    name: 'Fake Backed Up',
    type: 'bank',
    currency: 'AUD',
    openingBalanceCents: 0,
  })
  const made = await source.backup(OLD)
  if (!made.ok) throw new Error(made.reason)
  source.lock()
  held.openPath = join(root, 'fake.llbackup')
  writeFileSync(held.openPath, made.file)
  held.savePath = join(root, 'saved.llbackup')
  held.saves = []
  held.reads = 0

  vault = new Vault(join(root, 'ledger'), { derive, kdf: FAST })
  await vault.create(NEW)
  const handlers = new Map<Channel, (payload: never) => unknown>()
  const handle: Handle = (channel, handler) =>
    handlers.set(channel, handler as (payload: never) => unknown)
  handleBackup(vault, () => null, handle)
  handleImport(vault, () => null, handle)
  call = (channel, payload) =>
    handlers.get(channel)!(payload as never) as Promise<Results[typeof channel]>
})
afterEach(() => {
  held.steps.clear()
  vault.lock()
  rmSync(root, { recursive: true, force: true })
})

/** The vault as it was: in place, under NEW, without the backup's account. */
async function expectUnchanged() {
  expect(
    readdirSync(vault.root).filter((name) => name.startsWith(REPLACED_PREFIX)),
  ).toEqual([])
  expect(await vault.unlock(NEW)).toEqual({ ok: true })
  expect(
    vault.database().prepare('SELECT name FROM accounts').pluck().all(),
  ).toEqual([])
}

async function checked() {
  expect(await call('restore:open', undefined)).toMatchObject({ ok: true })
  expect(await call('restore:check', { password: OLD })).toMatchObject({
    ok: true,
  })
}

describe('a lock while a backup is made', () => {
  it('stops it before the save dialog when the key is being derived', async () => {
    await expect(
      lockAt('derive', vault, () => call('backup:save', { password: NEW })),
    ).rejects.toBeInstanceOf(LockedError)
    expect(held.saves).toEqual([])
  })

  it('writes nothing when the save dialog was open', async () => {
    await expect(
      lockAt('dialog', vault, () => call('backup:save', { password: NEW })),
    ).rejects.toBeInstanceOf(LockedError)
    expect(held.saves).toHaveLength(1)
    expect(existsSync(held.savePath)).toBe(false)
  })
})

describe('a lock while a backup is chosen', () => {
  it.each([
    ['dialog', 0],
    ['read', 1],
  ] as const)('keeps no file when it comes at the %s', async (step, reads) => {
    await expect(
      lockAt(step, vault, () => call('restore:open', undefined)),
    ).rejects.toBeInstanceOf(LockedError)
    expect(held.reads).toBe(reads)
    expect(await call('restore:check', { password: OLD })).toEqual({
      ok: false,
      reason: 'no-file',
    })
  })
})

describe('a lock while a backup is checked', () => {
  it('discards the staged copy', async () => {
    expect(await call('restore:open', undefined)).toMatchObject({ ok: true })
    await expect(
      lockAt('derive', vault, () => call('restore:check', { password: OLD })),
    ).rejects.toBeInstanceOf(LockedError)
    expect(readdirSync(vault.root)).toEqual(['vault'])
    expect(await call('restore:commit', { currentPassword: null })).toEqual({
      ok: false,
      reason: 'not-checked',
    })
  })
})

describe('a lock while a restore waits', () => {
  it('cancels it before it starts', async () => {
    await checked()
    // A backup holds the queue, so the restore waits behind it.
    let restoring!: Promise<unknown>
    const backup = lockAt('derive', vault, async () => {
      const made = vault.backup(NEW)
      restoring = call('restore:commit', { currentPassword: NEW })
      return made
    })
    expect(await backup).toEqual({ ok: false, reason: 'locked' })
    await expect(restoring).rejects.toBeInstanceOf(LockedError)
    await expectUnchanged()
  })

  it('stops it while the current password is derived', async () => {
    await checked()
    await expect(
      lockAt('derive', vault, () =>
        call('restore:commit', { currentPassword: NEW }),
      ),
    ).rejects.toBeInstanceOf(LockedError)
    await expectUnchanged()
  })
})

describe('a lock while a CSV file is chosen', () => {
  it('reads nothing after the open dialog', async () => {
    await expect(
      lockAt('dialog', vault, () => call('import:open', undefined)),
    ).rejects.toBeInstanceOf(LockedError)
    expect(held.reads).toBe(0)
  })
})
