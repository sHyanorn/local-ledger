import { useMemo, useState } from 'react'
import { NoticeBar } from '../components/NoticeBar'
import { groupedBars, horizontalBars, trendLine } from '../../../shared/charts'
import type { Currency } from '../../../shared/money'
import { ChartView } from '../components/ChartView'
import { ExportDialog } from './ExportDialog'
import {
  compactAmount,
  exactAmount,
  shortMonth,
} from '../../../shared/chart-format'
import { formatMonth, monthOf } from './format'
import { MonthStepper } from './MonthStepper'
import { categoryName, useLedger } from './store'
import { useLoaded } from './useLoaded'

export function ReportsView() {
  const accounts = useLedger((store) => store.accounts)
  const categories = useLedger((store) => store.categories)
  const currencies = useMemo(
    () => [...new Set(accounts.map((account) => account.currency))].sort(),
    [accounts],
  )
  const [chosen, setCurrency] = useState<Currency | null>(null)
  const currency = chosen ?? currencies[0] ?? 'AUD'
  const [month, setMonth] = useState(monthOf)
  const { value: answer, failed } = useLoaded(
    () => window.ledger.reports.month(month, currency),
    [month, currency],
  )
  // An answer for another month or currency is not shown under this one.
  const data =
    answer?.report.month === month && answer.report.currency === currency
      ? answer
      : null
  const topLevel = categories.filter((category) => category.parentId === null)
  const [trendCategory, setTrendCategory] = useState<number | null>(null)
  const trendId = trendCategory ?? topLevel[0]?.id ?? null
  const trendKey = `${trendId}:${month}:${currency}`
  const { value: trendAnswer, failed: trendFailed } = useLoaded(
    async () =>
      trendId === null
        ? null
        : {
            key: trendKey,
            points: await window.ledger.reports.trend(trendId, month, currency),
          },
    [trendKey],
  )
  const trend = trendAnswer?.key === trendKey ? trendAnswer.points : null
  const [exporting, setExporting] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const axis = compactAmount(currency)
  const exact = exactAmount(currency)
  const name = (id: number | null) =>
    id === null ? 'Uncategorized' : (categoryName(categories, id) ?? 'Deleted')

  return (
    <div className="content">
      <header className="toolbar">
        <h1>Reports</h1>
        <div className="actions month-switch">
          {currencies.length > 1 && (
            <select
              aria-label="Currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
            >
              {currencies.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          )}
          <MonthStepper month={month} onChange={setMonth} />
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setSaved(null)
              setExporting(true)
            }}
          >
            Export…
          </button>
        </div>
      </header>
      <div className="scroll">
        {failed && <p className="empty">The report could not be loaded.</p>}
        {data && (
          <div className="reports">
            <section aria-labelledby="months-heading">
              <h2 id="months-heading">Income and Spending</h2>
              <ChartView
                chart={groupedBars({
                  groups: data.months.map((totals) => ({
                    label: shortMonth(totals.month),
                    values: [totals.incomeCents, totals.spendingCents],
                  })),
                  series: ['income', 'spending'],
                  format: axis,
                  label: `Income and spending by month to ${formatMonth(month)}`,
                })}
              />
              <p className="legend">
                <span className="key income" /> Income
                <span className="key spending" /> Spending
              </p>
            </section>
            <section aria-labelledby="categories-heading">
              <h2 id="categories-heading">
                Spending by Category, {formatMonth(month)}
              </h2>
              {data.report.categories.some((entry) => entry.netCents < 0) ? (
                <ChartView
                  chart={horizontalBars({
                    items: data.report.categories
                      .filter((entry) => entry.netCents < 0)
                      .map((entry) => ({
                        label: name(entry.categoryId),
                        value: -entry.netCents,
                      })),
                    format: exact,
                    label: `Spending by category in ${formatMonth(month)}`,
                  })}
                />
              ) : (
                <p className="empty">No spending</p>
              )}
            </section>
            {trendId !== null && (trend || trendFailed) && (
              <section aria-labelledby="trend-heading">
                <div className="section-heading">
                  <h2 id="trend-heading">Trend</h2>
                  <select
                    aria-label="Category for the trend"
                    value={trendId}
                    onChange={(event) =>
                      setTrendCategory(Number(event.target.value))
                    }
                  >
                    {topLevel.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
                {trend ? (
                  <ChartView
                    chart={trendLine({
                      points: trend.map((point) => ({
                        label: shortMonth(point.month),
                        value: point.spentCents,
                      })),
                      format: axis,
                      label: `Spending on ${name(trendId)} by month`,
                    })}
                  />
                ) : (
                  <p className="empty">The trend could not be loaded.</p>
                )}
              </section>
            )}
          </div>
        )}
      </div>
      <div aria-live="polite">
        <NoticeBar message={saved} onDismiss={() => setSaved(null)} />
      </div>
      {exporting && (
        <ExportDialog
          month={month}
          currency={currency}
          onDone={(done) => {
            setExporting(false)
            if (done) setSaved(`Exported ${formatMonth(month)}.`)
          }}
        />
      )}
    </div>
  )
}
