// The vault host: a utility process that holds the vault, its database and
// everything read from them, and answers each page over a port of its own.
// The main process starts one for the locked page and ends it at the next
// lock, so what it held, the master password included, goes with it.
import type { MessagePortMain } from 'electron'
import type { PortAnswer, PortCall } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import { handleBackup } from './backup/handlers'
import { createDispatcher, type Dispatch } from './dispatch'
import { handleExport } from './export/handlers'
import type { FromHost, ToHost } from './host-protocol'
import { handleImport } from './import/handlers'
import { handleLedger } from './ledger/handlers'
import { getSettings } from './ledger/settings'
import { handlePasswordChange } from './password-change'
import type { MainServices } from './services'
import { deriveInWorker } from './vault/derive-in-worker'
import { probeVault } from './vault/probe'
import { LockedError, Vault } from './vault/vault'

const parent = process.parentPort
const post = (message: FromHost) => parent.postMessage(message)

parent.once('message', ({ data }) => {
  const { root, testHooks } = data as Extract<ToHost, { type: 'start' }>
  const vault = new Vault(root, { derive: deriveInWorker })
  const main = askMain()
  const { handle, dispatch, close, failNext } = createDispatcher()
  const idle = ({ idleLockMinutes }: Settings) =>
    post({ type: 'idle', minutes: idleLockMinutes })

  handle('vault:status', () => vault.state)
  handle('vault:create', ({ password }) => vault.create(password))
  handle('vault:unlock', ({ password }) => vault.unlock(password))
  handlePasswordChange(vault, handle)
  handleLedger(vault, handle, idle)
  handleImport(vault, main, handle)
  handleExport(vault, main, handle)
  const backups = handleBackup(vault, main, handle)
  vault.onChange((state) => {
    post({ type: 'state', state })
    if (state === 'unlocked') idle(getSettings(vault.database()))
  })

  parent.on('message', ({ data, ports }) => {
    const message = data as ToHost
    switch (message.type) {
      case 'page':
        if (ports[0]) serve(ports[0], dispatch)
        break
      case 'lock': {
        // New calls are refused. Those running stop at their next step, as
        // vault.lock() says, or finish the step they are in: a save finishes
        // or removes its temporary file. One waiting for a dialog stops now,
        // as it would once answered. The host exits once they settle.
        const settled = close()
        // Also at setup, where there is no vault to lock and so no change
        // for the backup handlers to hear of.
        backups.forget()
        vault.lock()
        main.cancel()
        void settled.then(() => process.exit(0))
        break
      }
      case 'answer':
      case 'refused':
        main.answer(message)
        break
      case 'probe':
        post({
          type: 'probe',
          probe: vault.unlocked ? probeVault(vault) : null,
        })
        break
      case 'fail-next':
        if (testHooks) failNext(message.channel)
        break
    }
  })
  post({ type: 'ready' })
})

/** Answers a page's calls; the port reaches only pages of this app. */
function serve(port: MessagePortMain, dispatch: Dispatch): void {
  port.on('message', ({ data }) => {
    const { id, channel, payload } = (data ?? {}) as Partial<PortCall>
    if (typeof id !== 'number' || typeof channel !== 'string') return
    const answer = (message: PortAnswer) => port.postMessage(message)
    dispatch(channel, payload).then(
      (result) => answer({ id, ok: true, result }),
      (error: Error) => answer({ id, ok: false, code: error.message }),
    )
  })
  port.start()
}

/** The main process's services, asked for over the parent port. */
function askMain(): MainServices & {
  answer(message: Extract<ToHost, { type: 'answer' | 'refused' }>): void
  /** Fails what still waits for an answer, as locked. */
  cancel(): void
} {
  let next = 0
  const waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  const ask = <T>(
    request: FromHost & { id: number },
    signal?: AbortSignal,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('cancelled'))
      waiting.set(request.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      post(request)
      signal?.addEventListener(
        'abort',
        () => {
          if (!waiting.delete(request.id)) return
          post({ type: 'cancel', id: request.id })
          reject(new Error('cancelled'))
        },
        { once: true },
      )
    })
  return {
    openPath: (filter) => ask({ type: 'open', id: next++, filter }),
    savePath: (name, filter) => ask({ type: 'save', id: next++, name, filter }),
    printPdf: async (html, css, signal) => {
      const pdf = await ask<Uint8Array>(
        { type: 'print', id: next++, html, css },
        signal,
      )
      return Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength)
    },
    answer: (message) => {
      const call = waiting.get(message.id)
      if (!call) {
        // A PDF for an export that was cancelled meanwhile.
        if (message.type === 'answer' && message.value instanceof Uint8Array)
          message.value.fill(0)
        return
      }
      waiting.delete(message.id)
      if (message.type === 'answer') call.resolve(message.value)
      else call.reject(new Error('refused'))
    },
    cancel: () => {
      for (const call of waiting.values()) call.reject(new LockedError())
      waiting.clear()
    },
  }
}
