import { create } from 'zustand'
import { budgetState, HOME_CURRENCY } from '../../../shared/budgets'
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
  /** Categories over their budget this month; null until first loaded. */
  overBudget: number[] | null
  /** A message about the last change, such as an import, shown under the list until dismissed. */
  notice: string | null
  setNotice(notice: string | null): void
  view: View
  show(view: View): void
  /** Reloads accounts and categories after a change. */
  refresh(): Promise<void>
}

export const useLedger = create<LedgerStore>((set, get) => ({
  accounts: [],
  categories: [],
  transfersToReview: 0,
  overBudget: null,
  notice: null,
  setNotice: (notice) => set({ notice }),
  view: { name: 'overview' },
  show: (view) => set({ view }),
  refresh: async () => {
    const month = monthOf()
    const [accounts, categories, transfersToReview, budgets] =
      await Promise.all([
        window.ledger.accounts.list(),
        window.ledger.categories.list(),
        window.ledger.transfers.count(),
        window.ledger.budgets.month(month),
      ])
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
        notice: `${name} is ${formatAmount(first.spentCents - first.budgetCents, HOME_CURRENCY)} over its budget for ${formatMonth(month)}.`,
      })
    }
    const gone =
      view.name === 'transactions' &&
      view.accountId !== null &&
      !accounts.some((account) => account.id === view.accountId)
    set({
      accounts,
      categories,
      transfersToReview,
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

/** "1 transaction", "1,204 transactions". */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString('en-AU')} ${n === 1 ? noun : plural}`
}
