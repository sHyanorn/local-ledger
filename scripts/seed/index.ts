// npm run seed [-- --dir <path>] [--transactions <n>] [--seed <n>]
// Creates a demo vault filled with fake data. It never touches an existing
// vault, writes inside the repository by default, and refuses the app's own
// user data directories.
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { deriveHere } from '../../src/main/vault/kdf'
import { Vault } from '../../src/main/vault/vault'
import { DEMO_PASSWORD } from './demo'
import { generateLedger } from './generate'
import { insertLedger } from './insert'
import { isAppUserData } from './user-data'

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: '.demo/user-data' },
    transactions: { type: 'string', default: '1500' },
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

if (isAppUserData(dir)) {
  console.error(`${dir} is where the app keeps its own data; choose another.`)
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
const demo = resolve('.demo/user-data')
console.log(
  `Start the app on it with: ${
    dir === demo
      ? 'npm run demo'
      : `npx electron-vite dev -- --user-data-dir="${dir}"`
  }`,
)
