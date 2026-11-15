// Messages between the main process and the vault host. The main process
// sends ports, a lock, and the answers to the host's requests: a path the
// user chose, a printed PDF. The host sends no ledger data back, except a
// page to print.
import { z } from 'zod'
import type { Channel, VaultState } from '../shared/ipc'
import { IDLE_LOCK_CHOICES } from '../shared/settings'
import type { VaultProbe } from './vault/probe'

export type ToHost =
  | { type: 'start'; root: string; testHooks: boolean }
  /** With the port of a page. */
  | { type: 'page' }
  | { type: 'lock' }
  | { type: 'answer'; id: number; value: string | Uint8Array | null }
  | { type: 'refused'; id: number }
  | { type: 'probe' }
  | { type: 'fail-next'; channel: Channel }

const id = z.number().int().nonnegative()
const filter = z.strictObject({
  name: z.string().max(100),
  extensions: z.array(z.string().max(10)).max(4),
})

/** What the main process accepts from the host. */
export const fromHost = z.discriminatedUnion('type', [
  /** The vault opened, closed or changed: the page is out of date. */
  z.strictObject({
    type: z.literal('state'),
    state: z.enum(['new', 'locked', 'unlocked', 'damaged']),
  }),
  /** The open vault's auto-lock setting. */
  z.strictObject({
    type: z.literal('idle'),
    minutes: z.union(IDLE_LOCK_CHOICES.map((minutes) => z.literal(minutes))),
  }),
  z.strictObject({ type: z.literal('open'), id, filter }),
  z.strictObject({
    type: z.literal('save'),
    id,
    name: z.string().max(255),
    filter,
  }),
  z.strictObject({
    type: z.literal('print'),
    id,
    html: z.string(),
    css: z.string(),
  }),
  z.strictObject({ type: z.literal('cancel'), id }),
  z.strictObject({ type: z.literal('probe'), probe: z.unknown() }),
])

export type FromHost =
  | Exclude<z.infer<typeof fromHost>, { type: 'probe' | 'state' }>
  | { type: 'state'; state: VaultState }
  | { type: 'probe'; probe: VaultProbe | null }
