// Monthly figures for reports, from report_transactions in one currency.
// See shared/reports.ts for how income and spending are told apart.
import type { Currency } from '../../shared/money'
import type {
  MonthReport,
  MonthTotals,
  ReportData,
  TrendPoint,
} from '../../shared/reports'
import type { Db } from '../vault/database'

const MONTHS = 12

/** The month `offset` months from this one, YYYY-MM. */
export function shiftMonth(month: string, offset: number): string {
  const [year = 0, number = 1] = month.split('-').map(Number)
  const total = year * 12 + (number - 1) + offset
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** Each month's top-level category nets, for months from `first` to `last`. */
function nets(
  db: Db,
  currency: Currency,
  first: string,
  last: string,
): Map<string, Map<number | null, number>> {
  const rows = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month,
         coalesce(c.parent_id, c.id) AS categoryId,
         sum(t.amount_cents) AS cents
       FROM report_transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE a.currency = ? AND t.date >= ? AND t.date < ?
       GROUP BY month, categoryId`,
    )
    .all(currency, `${first}-01`, `${shiftMonth(last, 1)}-01`) as {
    month: string
    categoryId: number | null
    cents: number
  }[]
  const byMonth = new Map<string, Map<number | null, number>>()
  for (const row of rows) {
    const month = byMonth.get(row.month) ?? new Map<number | null, number>()
    month.set(row.categoryId, row.cents)
    byMonth.set(row.month, month)
  }
  return byMonth
}

function totals(
  month: string,
  net: Map<number | null, number> | undefined,
): MonthTotals {
  let incomeCents = 0
  let spendingCents = 0
  for (const cents of net?.values() ?? []) {
    if (cents > 0) incomeCents += cents
    else spendingCents -= cents
  }
  return { month, incomeCents, spendingCents }
}

/** The month's report and the totals of the twelve months to it. */
export function reportData(
  db: Db,
  month: string,
  currency: Currency,
): ReportData {
  const first = shiftMonth(month, -(MONTHS - 1))
  const byMonth = nets(db, currency, first, month)
  const net = byMonth.get(month)
  const { incomeCents, spendingCents } = totals(month, net)
  const report: MonthReport = {
    month,
    currency,
    incomeCents,
    spendingCents,
    categories: [...(net ?? new Map<number | null, number>())]
      .map(([categoryId, netCents]) => ({ categoryId, netCents }))
      .sort((a, b) => a.netCents - b.netCents),
  }
  const months = Array.from({ length: MONTHS }, (_, index) => {
    const each = shiftMonth(first, index)
    return totals(each, byMonth.get(each))
  })
  return { report, months }
}

/** A category's spending in each of the twelve months to this one. */
export function categoryTrend(
  db: Db,
  categoryId: number,
  month: string,
  currency: Currency,
): TrendPoint[] {
  const first = shiftMonth(month, -(MONTHS - 1))
  const rows = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month, sum(t.amount_cents) AS cents
       FROM report_transactions t
       JOIN accounts a ON a.id = t.account_id
       JOIN categories c ON c.id = t.category_id
       WHERE a.currency = ? AND t.date >= ? AND t.date < ?
         AND (c.id = ? OR c.parent_id = ?)
       GROUP BY month`,
    )
    .all(
      currency,
      `${first}-01`,
      `${shiftMonth(month, 1)}-01`,
      categoryId,
      categoryId,
    ) as {
    month: string
    cents: number
  }[]
  const byMonth = new Map(rows.map((row) => [row.month, row.cents]))
  return Array.from({ length: MONTHS }, (_, index) => {
    const each = shiftMonth(first, index)
    return { month: each, spentCents: Math.max(0, -(byMonth.get(each) ?? 0)) }
  })
}
