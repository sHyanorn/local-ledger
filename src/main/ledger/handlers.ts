// IPC handlers for the ledger. Each reads the open database from the vault,
// so a call while the vault is locked fails with the code "locked".
import type { Handle } from '../ipc'
import type { Vault } from '../vault/vault'
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
} from './accounts'
import { monthBudgets, setBudget } from './budgets'
import { categoryTrend, reportData } from './reports'
import { getSettings, updateSettings } from './settings'
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

export function handleLedger(vault: Vault, handle: Handle): void {
  const db = () => vault.database()
  handle('accounts:list', () => listAccounts(db()))
  handle('accounts:create', (fields) => createAccount(db(), fields))
  handle('accounts:update', (fields) => updateAccount(db(), fields))
  handle('accounts:delete', ({ id }) => deleteAccount(db(), id))
  handle('categories:list', () => listCategories(db()))
  handle('categories:create', (fields) => createCategory(db(), fields))
  handle('categories:update', (fields) => updateCategory(db(), fields))
  handle('categories:delete', ({ id }) => deleteCategory(db(), id))
  handle('transactions:page', (page) => pageTransactions(db(), page))
  handle('transactions:totals', (filter) => totalTransactions(db(), filter))
  handle('transactions:create', (fields) => createTransaction(db(), fields))
  handle('transactions:update', (fields) => updateTransaction(db(), fields))
  handle('transactions:set-category', ({ id, categoryId }) =>
    setTransactionCategory(db(), id, categoryId),
  )
  handle('transactions:delete', ({ id }) => deleteTransaction(db(), id))
  handle('rules:list', () => listRules(db()))
  handle('rules:create', (fields) => createRule(db(), fields))
  handle('rules:update', (fields) => updateRule(db(), fields))
  handle('rules:delete', ({ id }) => deleteRule(db(), id))
  handle('rules:move', ({ id, offset }) => moveRule(db(), id, offset))
  handle('rules:reach', (rule) => ruleReach(db(), rule))
  handle('rules:suggest', ({ id }) => suggestRule(db(), id))
  handle('budgets:month', ({ month }) => monthBudgets(db(), month))
  handle('budgets:set', (budget) => setBudget(db(), budget))
  handle('settings:get', () => getSettings(db()))
  handle('settings:update', (changes) => updateSettings(db(), changes))
  handle('reports:month', ({ month, currency }) =>
    reportData(db(), month, currency),
  )
  handle('reports:trend', ({ categoryId, month, currency }) =>
    categoryTrend(db(), categoryId, month, currency),
  )
  handle('transfers:possible', () => possibleTransfers(db()))
  handle('transfers:count', () => countPossibleTransfers(db()))
  handle('transfers:choices', ({ id }) => transferChoices(db(), id))
  handle('transfers:link', ({ id, otherId }) => linkTransfer(db(), id, otherId))
  handle('transfers:unlink', ({ id }) => unlinkTransfer(db(), id))
  handle('transfers:reject', ({ outId, inId }) =>
    rejectTransfer(db(), outId, inId),
  )
  handle('rules:decline', ({ pattern }) => declineSuggestion(db(), pattern))
}
