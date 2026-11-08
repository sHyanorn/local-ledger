// npm run seed [-- --dir <path>] [--transactions <n>] [--seed <n>]
// Creates a demo vault filled with fake data. It never touches an existing
// vault, and by default writes inside the repository, not into the app's
// user data directory.
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { deriveHere } from '../../src/main/vault/kdf'
import { Vault } from '../../src/main/vault/vault'
import { DEMO_PASSWORD } from './demo'
import { generateLedger } from './generate'
import { insertLedger } from './insert'

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: '.demo/user-data' },
    transactions: { type: 'string', default: '3000' },
    seed: { type: 'string', default: '1' },
  },
})
const dir = resolve(values.dir)
const transactions = Number(values.transactions)
const seed = Number(values.seed)
if (
  !Number.isInteger(transactions) ||
  transactions < 0 ||
  !Number.isInteger(seed)
) {
  console.error('--transactions and --seed take whole numbers.')
  process.exit(1)
}

const vault = new Vault(dir, { derive: deriveHere })
if (vault.state !== 'new') {
  console.error(`A vault already exists in ${dir}; remove it to seed again.`)
  process.exit(1)
}
const created = await vault.create(DEMO_PASSWORD)
if (!created.ok)
  throw new Error(`could not create the vault: ${created.reason}`)
const ledger = generateLedger({ seed, transactions })
insertLedger(vault.database(), ledger)
vault.lock()

console.log(`Seeded ${ledger.transactions.length} fake transactions in ${dir}`)
console.log(`Demo password: ${DEMO_PASSWORD}`)
console.log('Start the app on it with: npm run demo')
