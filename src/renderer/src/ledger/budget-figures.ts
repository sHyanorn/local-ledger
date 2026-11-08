import type { CategoryBudget } from '../../../shared/budgets'
import { formatAmount, type Currency } from '../../../shared/money'

/** How much of the budget is spent, from 0 to 1; a zero budget is all spent. */
export function budgetShare(budget: CategoryBudget): number {
  if (budget.budgetCents === null) return 0
  if (budget.budgetCents === 0) return 1
  return Math.min(1, budget.spentCents / budget.budgetCents)
}

/** "$40.00 of $600.00", "$12.00 over $600.00", or without a budget "$40.00 spent". */
export function budgetFigure(
  budget: CategoryBudget,
  currency: Currency,
): string {
  const money = (cents: number) => formatAmount(cents, currency)
  const { budgetCents, spentCents } = budget
  if (budgetCents === null) return `${money(spentCents)} spent`
  return spentCents > budgetCents
    ? `${money(spentCents - budgetCents)} over ${money(budgetCents)}`
    : `${money(spentCents)} of ${money(budgetCents)}`
}
