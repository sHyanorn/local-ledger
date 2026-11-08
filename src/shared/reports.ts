// Reports as the page sees them. Every figure comes from report_transactions,
// so paired transfers are left out, and from one currency at a time.
import type { Currency } from './money'

/**
 * A month's income and spending. Each top-level category, with its
 * subcategories, and the uncategorized are netted; a net below zero is
 * spending, above zero income. A refund so lowers its category's spending.
 */
export interface MonthReport {
  month: string
  currency: Currency
  incomeCents: number
  spendingCents: number
  /** Top-level categories (null: uncategorized) and their nets, spending negative. */
  categories: { categoryId: number | null; netCents: number }[]
}

export interface MonthTotals {
  month: string
  incomeCents: number
  spendingCents: number
}

export interface ReportData {
  report: MonthReport
  /** The twelve months to this one, oldest first. */
  months: MonthTotals[]
}

/** A category's spending, subcategories included, net of refunds and never below zero. */
export interface TrendPoint {
  month: string
  spentCents: number
}
