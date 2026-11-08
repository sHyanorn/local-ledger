// IPC handlers for the ledger. Each reads the open database from the vault,
// so a call while the vault is locked fails with the code "locked".
import { handle } from '../ipc'
import type { Vault } from '../vault/vault'
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
} from './accounts'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from './categories'
import {
  createTransaction,
  deleteTransaction,
  pageTransactions,
  setTransactionCategory,
  totalTransactions,
  updateTransaction,
} from './transactions'

export function handleLedger(vault: Vault, devOrigin?: string): void {
  const db = () => vault.database()
  handle('accounts:list', () => listAccounts(db()), devOrigin)
  handle('accounts:create', (fields) => createAccount(db(), fields), devOrigin)
  handle('accounts:update', (fields) => updateAccount(db(), fields), devOrigin)
  handle('accounts:delete', ({ id }) => deleteAccount(db(), id), devOrigin)
  handle('categories:list', () => listCategories(db()), devOrigin)
  handle(
    'categories:create',
    (fields) => createCategory(db(), fields),
    devOrigin,
  )
  handle(
    'categories:update',
    (fields) => updateCategory(db(), fields),
    devOrigin,
  )
  handle('categories:delete', ({ id }) => deleteCategory(db(), id), devOrigin)
  handle('transactions:page', (page) => pageTransactions(db(), page), devOrigin)
  handle(
    'transactions:totals',
    (filter) => totalTransactions(db(), filter),
    devOrigin,
  )
  handle(
    'transactions:create',
    (fields) => createTransaction(db(), fields),
    devOrigin,
  )
  handle(
    'transactions:update',
    (fields) => updateTransaction(db(), fields),
    devOrigin,
  )
  handle(
    'transactions:set-category',
    ({ id, categoryId }) => setTransactionCategory(db(), id, categoryId),
    devOrigin,
  )
  handle(
    'transactions:delete',
    ({ id }) => deleteTransaction(db(), id),
    devOrigin,
  )
}
