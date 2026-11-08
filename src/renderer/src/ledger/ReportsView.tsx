import { useEffect, useMemo, useState } from 'react'
import { NoticeBar } from '../components/NoticeBar'
import { groupedBars, horizontalBars, trendLine } from '../../../shared/charts'
import type { Currency } from '../../../shared/money'
import type { ReportData, TrendPoint } from '../../../shared/reports'
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
  const [answer, setData] = useState<ReportData | null>(null)
  // An answer for another month or currency is not shown under this one.
  const data =
    answer?.report.month === month && answer.report.currency === currency
      ? answer
      : null
  const topLevel = categories.filter((category) => category.parentId === null)
  const [trendCategory, setTrendCategory] = useState<number | null>(null)
  const trendId = trendCategory ?? topLevel[0]?.id ?? null
  const [trendAnswer, setTrend] = useState<{
    key: string
    points: TrendPoint[]
  } | null>(null)
  const trendKey = `${trendId}:${month}:${currency}`
  const trend = trendAnswer?.key === trendKey ? trendAnswer.points : null
  const [exporting, setExporting] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    window.ledger.reports.month(month, currency).then(
      (answer) => current && setData(answer),
      () => current && setData(null),
    )
    return () => {
      current = false
    }
  }, [month, currency, categories])

  useEffect(() => {
    if (trendId === null) return
    let current = true
    window.ledger.reports.trend(trendId, month, currency).then(
      (points) => current && setTrend({ key: trendKey, points }),
      () => current && setTrend(null),
    )
    return () => {
      current = false
    }
  }, [trendId, month, currency, categories, trendKey])

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
            {trendId !== null && trend && (
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
