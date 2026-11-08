import { create } from 'zustand'
import type { ImportFile } from '../../../shared/imports'
import type { Account, Category } from '../../../shared/ledger'

export type View =
  | { name: 'transactions'; accountId: number | null }
  | { name: 'settings' }
  /** A file chosen for import, into the account shown when it was chosen. */
  | { name: 'import'; file: ImportFile; accountId: number | null }

interface LedgerStore {
  accounts: Account[]
  categories: Category[]
  view: View
  show(view: View): void
  /** Reloads accounts and categories after a change. */
  refresh(): Promise<void>
}

export const useLedger = create<LedgerStore>((set, get) => ({
  accounts: [],
  categories: [],
  view: { name: 'transactions', accountId: null },
  show: (view) => set({ view }),
  refresh: async () => {
    const [accounts, categories] = await Promise.all([
      window.ledger.accounts.list(),
      window.ledger.categories.list(),
    ])
    const { view } = get()
    const gone =
      view.name === 'transactions' &&
      view.accountId !== null &&
      !accounts.some((account) => account.id === view.accountId)
    set({
      accounts,
      categories,
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

/** "1 transaction", "1,204 transactions". */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString('en-AU')} ${n === 1 ? noun : plural}`
}
