// Runs Argon2id off the main thread, which it would otherwise block for
// hundreds of milliseconds. The worker ends after one derivation, releasing
// the memory Argon2id used.
import { parentPort, workerData } from 'node:worker_threads'
import { argon2 } from './kdf'
import type { KdfParams } from './kdf'

const { password, salt, params } = workerData as {
  password: Uint8Array
  salt: Uint8Array
  params: KdfParams
}

void argon2(password, salt, params).then((key) => {
  parentPort?.postMessage(key)
  key.fill(0)
})
