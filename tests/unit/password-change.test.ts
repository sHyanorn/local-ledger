// The notice after a password change: kept for the page that replaces the
// one that made the change, and only while the vault that change left is
// open.
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Handle } from '../../src/main/ipc'
import { handlePasswordChange } from '../../src/main/password-change'
import { deriveHere } from '../../src/main/vault/kdf'
import { Vault } from '../../src/main/vault/vault'
import type { Channel, Payload, Results } from '../../src/shared/ipc'
import { FAST, NEW, OLD } from '../support/vault'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ledger-notice-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** A vault under OLD and its handlers, called as the page calls them. */
async function opened(checkpoint?: (step: string) => void) {
  const vault = new Vault(root, { derive: deriveHere, kdf: FAST, checkpoint })
  await vault.create(OLD)
  const handlers = new Map<Channel, (payload: never) => unknown>()
  const handle: Handle = (channel, handler) =>
    handlers.set(channel, handler as (payload: never) => unknown)
  handlePasswordChange(vault, handle)
  const call = <C extends Channel>(channel: C, payload: Payload<C>) =>
    handlers.get(channel)!(payload as never) as Promise<Results[C]>
  return { vault, call }
}
const change = { current: OLD, next: NEW }

it('is taken once after a change', async () => {
  const { vault, call } = await opened()
  expect(await call('vault:take-notice', undefined)).toBeNull()
  expect(await call('vault:change-password', change)).toEqual({ ok: true })
  expect(await call('vault:take-notice', undefined)).toBe('password-changed')
  expect(await call('vault:take-notice', undefined)).toBeNull()
  vault.lock()
})

it('is not kept for a change that was refused', async () => {
  const { vault, call } = await opened()
  expect(
    await call('vault:change-password', { current: NEW, next: NEW }),
  ).toEqual({ ok: false, reason: 'wrong-password' })
  expect(await call('vault:take-notice', undefined)).toBeNull()
  vault.lock()
})

it('is gone once the vault locks', async () => {
  const { vault, call } = await opened()
  await call('vault:change-password', change)
  vault.lock()
  expect(await vault.unlock(NEW)).toEqual({ ok: true })
  expect(await call('vault:take-notice', undefined)).toBeNull()
  vault.lock()
})

it('is not kept when the change stands but left the vault locked', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const kept = join(root, 'kept.db')
  const database = join(root, 'vault', 'ledger-2.db')
  // The new database cannot be reopened right after the commit.
  const { vault, call } = await opened((step) => {
    if (step !== 'committed') return
    cpSync(database, kept)
    rmSync(database)
  })
  expect(await call('vault:change-password', change)).toEqual({ ok: true })
  log.mockRestore()
  expect(vault.unlocked).toBe(false)

  cpSync(kept, database)
  expect(await vault.unlock(NEW)).toEqual({ ok: true })
  expect(await call('vault:take-notice', undefined)).toBeNull()
  vault.lock()
})
