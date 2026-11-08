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
import { monthBudgets, setBudget } from './budgets'
import { categoryTrend, reportData } from './reports'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from './categories'
import {
  createRule,
  declineSuggestion,
  deleteRule,
  listRules,
  moveRule,
  ruleReach,
  suggestRule,
  updateRule,
} from './rules'
import {
  countPossibleTransfers,
  linkTransfer,
  possibleTransfers,
  rejectTransfer,
  transferChoices,
  unlinkTransfer,
} from './transfers'
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
  handle('rules:list', () => listRules(db()), devOrigin)
  handle('rules:create', (fields) => createRule(db(), fields), devOrigin)
  handle('rules:update', (fields) => updateRule(db(), fields), devOrigin)
  handle('rules:delete', ({ id }) => deleteRule(db(), id), devOrigin)
  handle(
    'rules:move',
    ({ id, offset }) => moveRule(db(), id, offset),
    devOrigin,
  )
  handle('rules:reach', (rule) => ruleReach(db(), rule), devOrigin)
  handle('rules:suggest', ({ id }) => suggestRule(db(), id), devOrigin)
  handle('budgets:month', ({ month }) => monthBudgets(db(), month), devOrigin)
  handle('budgets:set', (budget) => setBudget(db(), budget), devOrigin)
  handle(
    'reports:month',
    ({ month, currency }) => reportData(db(), month, currency),
    devOrigin,
  )
  handle(
    'reports:trend',
    ({ categoryId, month, currency }) =>
      categoryTrend(db(), categoryId, month, currency),
    devOrigin,
  )
  handle('transfers:possible', () => possibleTransfers(db()), devOrigin)
  handle('transfers:count', () => countPossibleTransfers(db()), devOrigin)
  handle('transfers:choices', ({ id }) => transferChoices(db(), id), devOrigin)
  handle(
    'transfers:link',
    ({ id, otherId }) => linkTransfer(db(), id, otherId),
    devOrigin,
  )
  handle('transfers:unlink', ({ id }) => unlinkTransfer(db(), id), devOrigin)
  handle(
    'transfers:reject',
    ({ outId, inId }) => rejectTransfer(db(), outId, inId),
    devOrigin,
  )
  handle(
    'rules:decline',
    ({ pattern }) => declineSuggestion(db(), pattern),
    devOrigin,
  )
}
