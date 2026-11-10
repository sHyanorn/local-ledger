// Settings and fake passphrases shared by the vault tests.
import type { KdfParams } from '../../src/main/vault/kdf'

/** The cheapest key derivation a vault accepts, so tests run fast. */
export const FAST: KdfParams = {
  memoryKiB: 19_456,
  iterations: 1,
  parallelism: 1,
}
export const PASSWORD = 'fake ledger passphrase for tests'
export const OLD = 'old fake ledger passphrase'
export const NEW = 'new fake ledger passphrase'
