// The restore channels in each vault state: with no vault, a locked one, one
// that does not open, and an open one.
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleBackup } from '../../src/main/backup/handlers'
import type { Handle } from '../../src/main/ipc'
import { createAccount } from '../../src/main/ledger/accounts'
import { deriveHere } from '../../src/main/vault/kdf'
import { REPLACED_PREFIX } from '../../src/main/vault/layout'
import { Vault } from '../../src/main/vault/vault'
import type { Channel, Payload, Results } from '../../src/shared/ipc'
import { tempDirs } from '../support/temp-dir'
import { FAST, NEW, OLD } from '../support/vault'

const dialog = vi.hoisted(() => ({ path: '' }))
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [dialog.path] }),
  },
}))

const newRoot = tempDirs('ledger-handlers-')
const open = (root: string) =>
  new Vault(root, { derive: deriveHere, kdf: FAST })
const names = (vault: Vault) =>
  vault
    .database()
    .prepare('SELECT name FROM accounts ORDER BY name')
    .pluck()
    .all()
const replaced = (root: string) =>
  readdirSync(root).filter((name) => name.startsWith(REPLACED_PREFIX))

/** The handlers of a vault, called as the page calls them. */
function channelsOf(vault: Vault) {
  const handlers = new Map<Channel, (payload: never) => unknown>()
  const handle: Handle = (channel, handler) =>
    handlers.set(channel, handler as (payload: never) => unknown)
  handleBackup(vault, () => null, handle)
  return <C extends Channel>(channel: C, payload: Payload<C>) =>
    handlers.get(channel)!(payload as never) as Promise<Results[C]>
}

/** A backup made under OLD, holding one account. */
beforeEach(async () => {
  const root = newRoot()
  const source = open(root)
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
  dialog.path = join(root, 'fake.llbackup')
  writeFileSync(dialog.path, made.file)
})

/** A vault under NEW, in the given state. */
async function vaultIn(state: 'new' | 'locked' | 'damaged' | 'unlocked') {
  const root = newRoot()
  const vault = open(root)
  if (state !== 'new') {
    await vault.create(NEW)
    if (state !== 'unlocked') vault.lock()
    if (state === 'damaged') rmSync(join(vault.dir, 'vault.json'))
  }
  expect(vault.state).toBe(state)
  return { root, vault }
}

describe.each([
  ['new', 0],
  ['locked', 1],
  ['damaged', 1],
] as const)('restoring over a %s vault', (state, aside) => {
  it('opens, checks and commits with the backup password alone', async () => {
    const { root, vault } = await vaultIn(state)
    const call = channelsOf(vault)
    expect(await call('restore:open', undefined)).toEqual({
      ok: true,
      name: 'fake.llbackup',
    })
    expect(await call('restore:check', { password: NEW })).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(await call('restore:check', { password: OLD })).toMatchObject({
      ok: true,
      summary: { accounts: 1 },
    })
    // A current password is for an open vault only.
    expect(await call('restore:commit', { currentPassword: NEW })).toEqual({
      ok: false,
      reason: 'exists',
    })
    expect(replaced(root)).toEqual([])
    expect(await call('restore:commit', { currentPassword: null })).toEqual({
      ok: true,
    })
    expect(names(vault)).toEqual(['Fake Backed Up'])
    expect(replaced(root)).toHaveLength(aside)
    vault.lock()
    expect(await vault.unlock(OLD)).toEqual({ ok: true })
    vault.lock()
  })
})

describe('restoring over an open vault', () => {
  it('opens and checks, and commits only with the current password', async () => {
    const { root, vault } = await vaultIn('unlocked')
    const call = channelsOf(vault)
    expect(await call('restore:open', undefined)).toMatchObject({ ok: true })
    expect(await call('restore:check', { password: OLD })).toMatchObject({
      ok: true,
    })
    expect(await call('restore:commit', { currentPassword: null })).toEqual({
      ok: false,
      reason: 'exists',
    })
    expect(await call('restore:commit', { currentPassword: OLD })).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    expect(names(vault)).toEqual([])
    expect(replaced(root)).toEqual([])
    expect(await call('restore:commit', { currentPassword: NEW })).toEqual({
      ok: true,
    })
    expect(names(vault)).toEqual(['Fake Backed Up'])
    expect(replaced(root)).toHaveLength(1)
    vault.lock()
    expect(await vault.unlock(NEW)).toEqual({ ok: true })
    vault.lock()
  })
})

describe('a backup chosen at the locked page', () => {
  it('is dropped by an unlock, and discarded when the dialog closes', async () => {
    const { root, vault } = await vaultIn('locked')
    const call = channelsOf(vault)
    const staging = () =>
      readdirSync(root).filter((name) => name.startsWith('vault.restoring-'))
    await call('restore:open', undefined)
    await call('restore:check', { password: OLD })
    expect(staging()).toHaveLength(1)
    await call('restore:discard', undefined)
    expect(staging()).toEqual([])

    await call('restore:open', undefined)
    await call('restore:check', { password: OLD })
    expect(await vault.unlock(NEW)).toEqual({ ok: true })
    expect(staging()).toEqual([])
    expect(await call('restore:commit', { currentPassword: NEW })).toEqual({
      ok: false,
      reason: 'not-checked',
    })
    expect(existsSync(vault.dir)).toBe(true)
    vault.lock()
  })
})

describe('a restore that is running', () => {
  it('keeps its backup: the other restore channels answer busy', async () => {
    const { vault } = await vaultIn('new')
    const call = channelsOf(vault)
    await call('restore:open', undefined)
    await call('restore:check', { password: OLD })
    const committing = call('restore:commit', { currentPassword: null })
    const busy = { ok: false, reason: 'busy' }
    expect(await call('restore:open', undefined)).toEqual(busy)
    expect(await call('restore:check', { password: OLD })).toEqual(busy)
    expect(await call('restore:commit', { currentPassword: null })).toEqual(
      busy,
    )
    expect(await committing).toEqual({ ok: true })
    expect(names(vault)).toEqual(['Fake Backed Up'])
    vault.lock()
  })
})
