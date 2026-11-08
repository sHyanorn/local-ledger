// Budgets as the page sees them. Free of zod, like ledger.ts.
import type { Currency } from './money'

/** A budget is close to spent from this share of it. */
export const CLOSE_SHARE = 0.9

export interface CategoryBudget {
  categoryId: number
  /** The budget in effect this month, or null for none. */
  budgetCents: number | null
  /** Spending this month in the home currency, subcategories included, net of refunds. */
  spentCents: number
}

export interface MonthBudgets {
  month: string
  /** The home currency, which budgets and their spending are in. */
  currency: Currency
  categories: CategoryBudget[]
  /** Home-currency spending this month without a category. */
  uncategorizedCents: number
  /** Spending in other currencies, which budgets do not count. */
  otherCurrencies: { currency: Currency; spentCents: number }[]
}

export type BudgetState = 'none' | 'under' | 'close' | 'over'

export function budgetState(budget: CategoryBudget): BudgetState {
  if (budget.budgetCents === null) return 'none'
  if (budget.spentCents > budget.budgetCents) return 'over'
  if (
    budget.budgetCents > 0 &&
    budget.spentCents >= budget.budgetCents * CLOSE_SHARE
  )
    return 'close'
  return 'under'
}
