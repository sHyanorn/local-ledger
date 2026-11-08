// The statement as one static HTML page for printing to PDF: no scripts,
// charts as SVG markup from the same geometry the Reports page draws.
import {
  compactAmount,
  exactAmount,
  shortMonth,
} from '../../shared/chart-format'
import { budgetState } from '../../shared/budgets'
import {
  chartMarkup,
  escapeHtml,
  groupedBars,
  horizontalBars,
} from '../../shared/charts'
import { formatAmount } from '../../shared/money'
import { formatMonth } from '../../shared/months'
import type { Statement } from './statement'

/** The page's title, which becomes the PDF's: fixed, so it holds no data. */
export const PDF_TITLE = 'Local Ledger Statement'

const DATE = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const day = (date: string) => DATE.format(new Date(`${date}T00:00:00Z`))

const STATE = { none: '', under: '', close: 'Close', over: 'Over' } as const

export function statementPage(statement: Statement): string {
  const { report, currency, month } = statement
  const money = (cents: number) => escapeHtml(formatAmount(cents, currency))
  const name = (id: number | null) =>
    id === null ? 'Uncategorized' : (statement.names.get(id) ?? '')
  const spending = report.categories.filter((entry) => entry.netCents < 0)

  const totals = `<div class="totals">
<div><span class="muted">Income</span><strong>${money(report.incomeCents)}</strong></div>
<div><span class="muted">Spending</span><strong>${money(report.spendingCents)}</strong></div>
<div><span class="muted">Net</span><strong>${money(report.incomeCents - report.spendingCents)}</strong></div>
</div>`

  const months = chartMarkup(
    groupedBars({
      groups: statement.months.map((totals) => ({
        label: shortMonth(totals.month),
        values: [totals.incomeCents, totals.spendingCents],
      })),
      series: ['income', 'spending'],
      format: compactAmount(currency),
      label: `Income and spending by month to ${formatMonth(month)}`,
    }),
  )
  const categories =
    spending.length > 0
      ? chartMarkup(
          horizontalBars({
            items: spending.map((entry) => ({
              label: name(entry.categoryId),
              value: -entry.netCents,
            })),
            format: exactAmount(currency),
            label: `Spending by category in ${formatMonth(month)}`,
          }),
        )
      : '<p class="muted">No spending</p>'

  const budgets =
    statement.budgets.length === 0
      ? ''
      : `<section><h2>Budgets</h2><table>
<thead><tr><th>Category</th><th class="number">Budget</th><th class="number">Spent</th><th class="number">Left</th><th></th></tr></thead>
<tbody>${statement.budgets
          .map((budget) => {
            const total = budget.budgetCents ?? 0
            const state = budgetState(budget)
            return `<tr><td>${escapeHtml(budget.name)}</td><td class="number">${money(total)}</td><td class="number">${money(budget.spentCents)}</td><td class="number${state === 'over' ? ' over' : ''}">${money(total - budget.spentCents)}</td><td>${STATE[state]}</td></tr>`
          })
          .join('')}</tbody></table></section>`

  const rows =
    statement.rows.length === 0
      ? '<p class="muted">No transactions</p>'
      : `<table>
<thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Category</th><th class="number">Amount</th></tr></thead>
<tbody>${statement.rows
          .map(
            (row) =>
              `<tr><td class="date">${escapeHtml(day(row.date))}</td><td>${escapeHtml(row.account)}</td><td>${escapeHtml(row.description)}${row.notes ? `<span class="note">${escapeHtml(row.notes)}</span>` : ''}</td><td>${escapeHtml(row.category)}</td><td class="number">${money(row.amountCents)}</td></tr>`,
          )
          .join('')}</tbody></table>`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${PDF_TITLE}</title>
<link rel="stylesheet" href="report.css"></head>
<body>
<header><h1>${escapeHtml(formatMonth(month))}</h1><span class="muted">${currency}</span></header>
${totals}
<section><h2>Income and Spending</h2>${months}
<p class="legend"><span class="key income"></span>Income<span class="key spending"></span>Spending</p></section>
<section><h2>Spending by Category</h2>${categories}</section>
${budgets}
<section class="rows"><h2>Transactions</h2>${rows}</section>
</body></html>`
}
