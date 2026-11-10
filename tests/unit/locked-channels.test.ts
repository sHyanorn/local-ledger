// Every data channel refuses while the vault is locked. The channels come
// from the shared list, so a new one must either refuse or be named here
// as one that answers.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { handleBackup } from '../../src/main/backup/handlers'
import { handleExport } from '../../src/main/export/handlers'
import { handleImport } from '../../src/main/import/handlers'
import { guard, type Handle } from '../../src/main/ipc'
import { handleLedger } from '../../src/main/ledger/handlers'
import { handlePasswordChange } from '../../src/main/password-change'
import { deriveHere } from '../../src/main/vault/kdf'
import { Vault } from '../../src/main/vault/vault'
import { channels, type Channel, type Payload } from '../../src/shared/ipc'
import { FAST, PASSWORD } from '../support/vault'

vi.mock('electron', () => ({ ipcMain: {}, dialog: {} }))

const APP = { senderFrame: { origin: 'app://local-ledger' } } as never

/** Channels that answer while locked: the vault's own, and a restore. */
const ANSWER_WHILE_LOCKED = [
  'vault:status',
  'vault:create',
  'vault:unlock',
  'vault:lock',
  'vault:change-password',
  'vault:take-notice',
  'restore:open',
  'restore:check',
  'restore:commit',
  'restore:discard',
] as const satisfies Channel[]

type Refusing = Exclude<Channel, (typeof ANSWER_WHILE_LOCKED)[number]>

const account: Payload<'accounts:create'> = {
  name: 'Fake',
  type: 'cash',
  currency: 'AUD',
  openingBalanceCents: 0,
}
const transaction = {
  accountId: 1,
  date: '2026-05-01',
  amountCents: -100,
  description: 'Fake',
  categoryId: null,
  notes: '',
}
const request: Payload<'import:preview'> = {
  id: '00000000-0000-4000-8000-000000000000',
  encoding: 'utf-8',
  mapping: {
    header: false,
    date: 0,
    dateOrder: 'dmy',
    description: [2],
    amount: { kind: 'signed', column: 1, negate: false },
  },
  targets: [{ key: '', accountId: 1 }],
}
const rule: Omit<Payload<'rules:update'>, 'id'> = {
  pattern: 'Fake',
  match: 'contains',
  categoryId: 1,
}

/** A valid payload for each channel that refuses. */
const payloads: { [C in Refusing]: Payload<C> } = {
  'accounts:list': undefined,
  'accounts:create': account,
  'accounts:update': { ...account, id: 1 },
  'accounts:delete': { id: 1 },
  'categories:list': undefined,
  'categories:create': { name: 'Fake', parentId: null },
  'categories:update': { name: 'Fake', parentId: null, id: 1 },
  'categories:delete': { id: 1 },
  'transactions:page': { filter: {}, limit: 10 },
  'transactions:totals': {},
  'transactions:create': transaction,
  'transactions:update': { ...transaction, id: 1 },
  'transactions:set-category': { id: 1, categoryId: null },
  'transactions:delete': { id: 1 },
  'import:open': undefined,
  'import:drop': { name: 'fake.csv', bytes: new Uint8Array(3) },
  'import:preview': request,
  'import:commit': { ...request, selected: [0] },
  'import:discard': { id: request.id },
  'import:batches': undefined,
  'import:undo': { id: 1 },
  'rules:list': undefined,
  'rules:create': { ...rule, apply: false },
  'rules:update': { ...rule, id: 1 },
  'rules:delete': { id: 1 },
  'rules:move': { id: 1, offset: 1 },
  'rules:reach': { pattern: 'Fake', match: 'is' },
  'rules:suggest': { id: 1 },
  'rules:decline': { pattern: 'Fake' },
  'transfers:possible': undefined,
  'transfers:count': undefined,
  'transfers:choices': { id: 1 },
  'transfers:link': { id: 1, otherId: 2 },
  'transfers:unlink': { id: 1 },
  'transfers:reject': { outId: 1, inId: 2 },
  'budgets:month': { month: '2026-05' },
  'budgets:set': { categoryId: 1, month: '2026-05', amountCents: 100 },
  'reports:month': { month: '2026-05', currency: 'AUD' },
  'reports:trend': { categoryId: 1, month: '2026-05', currency: 'AUD' },
  'export:save': { month: '2026-05', currency: 'AUD', format: 'pdf' },
  'settings:get': undefined,
  'settings:update': { idleLockMinutes: 1 },
  'backup:save': { password: PASSWORD },
}

let root: string
const handlers = new Map<Channel, Parameters<Handle>[1]>()

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ledger-locked-'))
  const vault = new Vault(root, { derive: deriveHere, kdf: FAST })
  await vault.create(PASSWORD)
  const handle: Handle = (channel, handler) =>
    handlers.set(channel, handler as Parameters<Handle>[1])
  handlePasswordChange(vault, handle)
  handleLedger(vault, handle)
  handleImport(vault, () => null, handle)
  handleExport(vault, () => null, handle)
  handleBackup(vault, () => null, handle)
  vault.lock()
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const refusing = (Object.keys(channels) as Channel[]).filter(
  (channel): channel is Refusing =>
    !(ANSWER_WHILE_LOCKED as readonly Channel[]).includes(channel),
)

it.each(refusing)('%s refuses while the vault is locked', async (channel) => {
  const handler = handlers.get(channel)
  expect(handler, 'a handler is registered').toBeDefined()
  const listener = guard(channel, handler!)
  await expect(listener(APP, payloads[channel])).rejects.toThrow(/^locked$/)
})
