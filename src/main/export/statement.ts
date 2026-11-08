// A month's statement in one currency, for the Excel and PDF exports: the
// report's figures, budgets when the currency is the home one, and every
// transaction of the month, transfers included and marked as such.
import { budgetState, type CategoryBudget } from '../../shared/budgets'
import type { Currency } from '../../shared/money'
import { formatMonth, shiftMonth } from '../../shared/months'
import type { MonthReport, MonthTotals } from '../../shared/reports'
import { reportData } from '../ledger/reports'
import { monthBudgets } from '../ledger/budgets'
import { getSettings } from '../ledger/settings'
import type { Db } from '../vault/database'
import type { Sheet } from './xlsx'

export interface StatementRow {
  date: string
  account: string
  description: string
  /** "Parent › Child", "Transfer › Account", or empty. */
  category: string
  amountCents: number
  notes: string
}

export interface Statement {
  month: string
  currency: Currency
  report: MonthReport
  /** The twelve months to this one, oldest first. */
  months: MonthTotals[]
  /** Top-level category names by id. */
  names: Map<number, string>
  /** Categories with a budget this month, for the home currency only. */
  budgets: (CategoryBudget & { name: string })[]
  rows: StatementRow[]
}

export function statement(
  db: Db,
  month: string,
  currency: Currency,
): Statement {
  const categories = db
    .prepare('SELECT id, name, parent_id AS parentId FROM categories')
    .all() as { id: number; name: string; parentId: number | null }[]
  const byId = new Map(categories.map((category) => [category.id, category]))
  const fullName = (id: number) => {
    const category = byId.get(id)
    const parent =
      category?.parentId == null ? undefined : byId.get(category.parentId)
    return parent
      ? `${parent.name} › ${category?.name}`
      : (category?.name ?? '')
  }
  const rows = (
    db
      .prepare(
        `SELECT t.date, a.name AS account, t.description,
           t.category_id AS categoryId, t.amount_cents AS amountCents,
           ifnull(t.notes, '') AS notes, oa.name AS transferAccount
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN transfer_links lo ON lo.out_id = t.id AND lo.status = 'confirmed'
         LEFT JOIN transfer_links li ON li.in_id = t.id AND li.status = 'confirmed'
         LEFT JOIN transactions other ON other.id = coalesce(lo.in_id, li.out_id)
         LEFT JOIN accounts oa ON oa.id = other.account_id
         WHERE a.currency = ? AND t.date >= ? AND t.date < ?
         ORDER BY t.date, t.id`,
      )
      .all(currency, `${month}-01`, `${shiftMonth(month, 1)}-01`) as {
      date: string
      account: string
      description: string
      categoryId: number | null
      amountCents: number
      notes: string
      transferAccount: string | null
    }[]
  ).map(({ categoryId, transferAccount, ...row }) => ({
    ...row,
    category:
      transferAccount !== null
        ? `Transfer › ${transferAccount}`
        : categoryId === null
          ? ''
          : fullName(categoryId),
  }))
  const budgets =
    currency === getSettings(db).homeCurrency
      ? monthBudgets(db, month)
          .categories.filter((budget) => budget.budgetCents !== null)
          .map((budget) => ({ ...budget, name: fullName(budget.categoryId) }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : []
  const { report, months } = reportData(db, month, currency)
  return {
    month,
    currency,
    report,
    months,
    names: new Map(categories.map((category) => [category.id, category.name])),
    budgets,
    rows,
  }
}

const STATE = {
  none: '',
  under: 'Under',
  close: 'Close',
  over: 'Over',
} as const

/** The statement as workbook sheets: summary, budgets if any, transactions. */
export function statementSheets(statement: Statement): Sheet[] {
  const { report, currency } = statement
  const categoryName = (id: number | null) =>
    id === null ? 'Uncategorized' : (statement.names.get(id) ?? '')
  const summary: Sheet = {
    name: 'Summary',
    widths: [28, 16],
    rows: [
      { cells: [`Statement for ${formatMonth(statement.month)}`], bold: true },
      { cells: ['Currency', currency] },
      { cells: [] },
      { cells: ['Income', { cents: report.incomeCents }] },
      { cells: ['Spending', { cents: report.spendingCents }] },
      {
        cells: ['Net', { cents: report.incomeCents - report.spendingCents }],
        bold: true,
      },
      { cells: [] },
      { cells: ['Category', `Net (${currency})`], bold: true },
      ...report.categories.map((entry) => ({
        cells: [categoryName(entry.categoryId), { cents: entry.netCents }],
      })),
    ],
  }
  const sheets: Sheet[] = [summary]
  if (statement.budgets.length > 0) {
    sheets.push({
      name: 'Budgets',
      widths: [32, 14, 14, 14, 10],
      freezeHeader: true,
      rows: [
        {
          cells: ['Category', 'Budget', 'Spent', 'Left', 'Status'],
          bold: true,
        },
        ...statement.budgets.map((budget) => ({
          cells: [
            budget.name,
            { cents: budget.budgetCents ?? 0 },
            { cents: budget.spentCents },
            { cents: (budget.budgetCents ?? 0) - budget.spentCents },
            STATE[budgetState(budget)],
          ],
        })),
      ],
    })
  }
  sheets.push({
    name: 'Transactions',
    widths: [12, 18, 44, 28, 14, 32],
    freezeHeader: true,
    rows: [
      {
        cells: [
          'Date',
          'Account',
          'Description',
          'Category',
          `Amount (${currency})`,
          'Notes',
        ],
        bold: true,
      },
      ...statement.rows.map((row) => ({
        cells: [
          { date: row.date },
          row.account,
          row.description,
          row.category || null,
          { cents: row.amountCents },
          row.notes || null,
        ],
      })),
    ],
  })
  return sheets
}
