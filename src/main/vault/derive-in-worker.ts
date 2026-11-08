import type { Derive } from './kdf'
import createKdfWorker from './kdf-worker?nodeWorker'

/** Derives in a worker thread; the password bytes move there and are wiped. */
export const deriveInWorker: Derive = (password, salt, params) =>
  new Promise((resolve, reject) => {
    const worker = createKdfWorker({
      workerData: { password, salt, params },
      transferList: [password.buffer as ArrayBuffer],
    })
    worker.once('message', (key: Uint8Array) => {
      resolve(Buffer.from(key.buffer, key.byteOffset, key.byteLength))
      void worker.terminate()
    })
    worker.once('error', (error) => {
      reject(error)
      void worker.terminate()
    })
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`key derivation exited with ${code}`))
    })
  })
