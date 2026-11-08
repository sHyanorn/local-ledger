// Monthly budgets per category, measured against spending in the home
// currency, a setting. Spending reads report_transactions, so paired transfers never
// count; refunds reduce it, and it is never below zero. A category's
// spending includes its subcategories', and each can have its own budget.
import type { MonthBudgets } from '../../shared/budgets'
import type { Outcome } from '../../shared/ipc'
import type { Currency } from '../../shared/money'
import { shiftMonth } from '../../shared/months'
import type { Db } from '../vault/database'
import { orNotFound } from './errors'
import { monthSpending } from './reports'
import { getSettings } from './settings'

export function monthBudgets(db: Db, month: string): MonthBudgets {
  const range = [`${month}-01`, `${shiftMonth(month, 1)}-01`]
  const home = getSettings(db).homeCurrency
  const categories = db
    .prepare('SELECT id, parent_id AS parentId FROM categories')
    .all() as { id: number; parentId: number | null }[]
  const net = new Map(
    (
      db
        .prepare(
          `SELECT t.category_id AS id, sum(t.amount_cents) AS cents
           FROM report_transactions t JOIN accounts a ON a.id = t.account_id
           WHERE a.currency = ? AND t.date >= ? AND t.date < ?
             AND t.category_id IS NOT NULL
           GROUP BY t.category_id`,
        )
        .all(home, ...range) as { id: number; cents: number }[]
    ).map((row) => [row.id, row.cents]),
  )
  // A category's own transactions and its subcategories'.
  const total = new Map<number, number>()
  for (const category of categories) {
    const own = net.get(category.id) ?? 0
    total.set(category.id, (total.get(category.id) ?? 0) + own)
    if (category.parentId !== null) {
      total.set(category.parentId, (total.get(category.parentId) ?? 0) + own)
    }
  }
  const budgets = new Map(
    (
      db
        .prepare(
          `SELECT b.category_id AS id, b.amount_cents AS cents
           FROM budgets b
           WHERE b.month = (SELECT max(month) FROM budgets
                            WHERE category_id = b.category_id AND month <= ?)`,
        )
        .all(month) as { id: number; cents: number | null }[]
    ).map((row) => [row.id, row.cents]),
  )
  const uncategorized = db
    .prepare(
      `SELECT ifnull(sum(t.amount_cents), 0)
       FROM report_transactions t JOIN accounts a ON a.id = t.account_id
       WHERE a.currency = ? AND t.date >= ? AND t.date < ?
         AND t.category_id IS NULL`,
    )
    .pluck()
    .get(home, ...range) as number
  // Spending as Reports counts it: refunds netted within each category.
  const others = (
    db
      .prepare(
        'SELECT DISTINCT currency FROM accounts WHERE currency <> ? ORDER BY currency',
      )
      .pluck()
      .all(home) as Currency[]
  )
    .map((currency) => ({
      currency,
      spentCents: monthSpending(db, month, currency),
    }))
    .filter((other) => other.spentCents > 0)
  return {
    month,
    currency: home,
    categories: categories.map((category) => ({
      categoryId: category.id,
      budgetCents: budgets.get(category.id) ?? null,
      spentCents: Math.max(0, -(total.get(category.id) ?? 0)),
    })),
    uncategorizedCents: Math.max(0, -uncategorized),
    otherCurrencies: others,
  }
}

/** Sets the budget from this month on; null ends it from this month. */
export function setBudget(
  db: Db,
  {
    categoryId,
    month,
    amountCents,
  }: { categoryId: number; month: string; amountCents: number | null },
): Outcome<'not-found'> {
  return orNotFound(() => {
    db.prepare(
      `INSERT INTO budgets (category_id, month, amount_cents) VALUES (?, ?, ?)
       ON CONFLICT (category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
    ).run(categoryId, month, amountCents)
    return { ok: true }
  })
}
