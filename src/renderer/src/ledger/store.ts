import { create } from 'zustand'
import { budgetState } from '../../../shared/budgets'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings'
import type { ImportFile } from '../../../shared/imports'
import { formatAmount } from '../../../shared/money'
import { formatMonth, monthOf } from './format'
import type { Account, Category } from '../../../shared/ledger'

export type View =
  | { name: 'overview' }
  | { name: 'reports' }
  | { name: 'transactions'; accountId: number | null }
  | { name: 'settings' }
  /** Pairs that may be transfers, for the user to decide. */
  | { name: 'transfers' }
  | { name: 'budgets' }
  /** A file chosen for import, into the account shown when it was chosen. */
  | { name: 'import'; file: ImportFile; accountId: number | null }

interface LedgerStore {
  accounts: Account[]
  categories: Category[]
  /** Possible transfers waiting for the user. */
  transfersToReview: number
  settings: Settings
  /** Categories over their budget this month; null until first loaded. */
  overBudget: number[] | null
  /** A message about the last change, such as an import, shown under the list until dismissed. */
  notice: string | null
  setNotice(notice: string | null): void
  /** A category that has just gone over its budget, shown over any view until dismissed. */
  budgetNotice: string | null
  setBudgetNotice(notice: string | null): void
  view: View
  show(view: View): void
  /** A menu command for the transaction list, waiting for it to act. */
  request: { command: 'new-transaction' | 'find'; id: number } | null
  ask(command: 'new-transaction' | 'find'): void
  done(): void
  /** Whether the last reload failed, leaving what was loaded before. */
  reloadFailed: boolean
  setReloadFailed(failed: boolean): void
  /** Reloads accounts and categories after a change; never fails. */
  refresh(): Promise<void>
}

let refreshes = 0

export const useLedger = create<LedgerStore>((set, get) => ({
  accounts: [],
  categories: [],
  transfersToReview: 0,
  settings: DEFAULT_SETTINGS,
  overBudget: null,
  notice: null,
  setNotice: (notice) => set({ notice }),
  budgetNotice: null,
  setBudgetNotice: (budgetNotice) => set({ budgetNotice }),
  view: { name: 'overview' },
  show: (view) => set({ view }),
  request: null,
  ask: (command) =>
    set(({ request }) => ({
      request: { command, id: (request?.id ?? 0) + 1 },
    })),
  done: () => set({ request: null }),
  reloadFailed: false,
  setReloadFailed: (reloadFailed) => set({ reloadFailed }),
  refresh: async () => {
    // Answers can arrive out of order; only the latest request's counts.
    const ticket = ++refreshes
    const month = monthOf()
    let answers
    try {
      answers = await Promise.all([
        window.ledger.accounts.list(),
        window.ledger.categories.list(),
        window.ledger.transfers.count(),
        window.ledger.budgets.month(month),
        window.ledger.settings.get(),
      ])
    } catch {
      // The change itself was made; only the figures shown are behind.
      if (ticket === refreshes) set({ reloadFailed: true })
      return
    }
    if (ticket !== refreshes) return
    const [accounts, categories, transfersToReview, budgets, settings] = answers
    const { view, overBudget: before } = get()
    const over = budgets.categories.filter(
      (budget) => budgetState(budget) === 'over',
    )
    // A category that has just gone over its budget is worth a word.
    const crossed = before
      ? over.filter((budget) => !before.includes(budget.categoryId))
      : []
    const first = crossed[0]
    const name = categories.find((c) => c.id === first?.categoryId)?.name
    if (first && name && first.budgetCents !== null) {
      set({
        budgetNotice: `${name} is ${formatAmount(first.spentCents - first.budgetCents, budgets.currency)} over its budget for ${formatMonth(month)}.`,
      })
    }
    const gone =
      view.name === 'transactions' &&
      view.accountId !== null &&
      !accounts.some((account) => account.id === view.accountId)
    set({
      reloadFailed: false,
      accounts,
      categories,
      transfersToReview,
      settings,
      overBudget: over.map((budget) => budget.categoryId),
      ...(gone ? { view: { name: 'transactions', accountId: null } } : {}),
    })
  },
}))

/** Top-level categories, each followed by its subcategories. */
export function categoryTree(
  categories: Category[],
): { category: Category; children: Category[] }[] {
  return categories
    .filter((category) => category.parentId === null)
    .map((category) => ({
      category,
      children: categories.filter((child) => child.parentId === category.id),
    }))
}

/** "Food › Coffee" for a subcategory, "Food" for a top-level category. */
export function categoryName(
  categories: Category[],
  id: number | null,
): string | null {
  const category = categories.find((option) => option.id === id)
  if (!category) return null
  const parent = categories.find((option) => option.id === category.parentId)
  return parent ? `${parent.name} › ${category.name}` : category.name
}
