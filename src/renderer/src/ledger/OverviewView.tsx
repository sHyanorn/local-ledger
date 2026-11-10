import { budgetState } from '../../../shared/budgets'
import { formatAmount, type Currency } from '../../../shared/money'
import { BudgetBar } from './BudgetBar'
import { budgetFigure, budgetShare } from './budget-figures'
import { formatDate, formatMonth, monthOf } from './format'
import { categoryName, useLedger } from './store'
import { useLoaded } from './useLoaded'

/** This month at a glance: income and spending, budgets, the latest transactions. */
export function OverviewView() {
  const accounts = useLedger((store) => store.accounts)
  const categories = useLedger((store) => store.categories)
  const show = useLedger((store) => store.show)
  const home = useLedger((store) => store.settings.homeCurrency)
  const month = monthOf()
  const currencies = [
    ...new Set(accounts.map((account) => account.currency)),
  ].sort((a, b) => (a === home ? -1 : b === home ? 1 : a.localeCompare(b)))
  const key = currencies.join(',')
  const { value: loaded, failed } = useLoaded(
    () =>
      Promise.all([
        Promise.all(
          key
            .split(',')
            .filter(Boolean)
            .map((currency) =>
              window.ledger.reports.month(month, currency as Currency),
            ),
        ),
        window.ledger.budgets.month(month),
        window.ledger.transactions.page({}, 5),
      ]),
    [key, month],
  )
  const [reports, budgets, page] = loaded ?? [[], null, null]
  const recent = page?.rows ?? []

  const budgeted =
    budgets?.categories.filter((budget) => budget.budgetCents !== null) ?? []

  return (
    <div className="content">
      <header className="toolbar">
        <h1>{formatMonth(month)}</h1>
      </header>
      <div className="scroll">
        <div className="overview">
          {failed && <p className="empty">The overview could not be loaded.</p>}
          <div className="cards">
            {reports
              .filter(
                ({ report }) =>
                  report.currency === home ||
                  report.incomeCents !== 0 ||
                  report.spendingCents !== 0,
              )
              .map(({ report }) => (
                <div key={report.currency} className="card-group">
                  <div className="card">
                    <span className="muted">Income</span>
                    <strong className="positive">
                      {formatAmount(report.incomeCents, report.currency)}
                    </strong>
                  </div>
                  <div className="card">
                    <span className="muted">Spending</span>
                    <strong>
                      {formatAmount(report.spendingCents, report.currency)}
                    </strong>
                  </div>
                </div>
              ))}
          </div>

          {budgeted.length > 0 && (
            <section aria-labelledby="overview-budgets">
              <div className="section-heading">
                <h2 id="overview-budgets">Budgets</h2>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => show({ name: 'budgets' })}
                >
                  All Budgets
                </button>
              </div>
              <ul className="list">
                {budgeted.map((budget) => {
                  return (
                    <li
                      key={budget.categoryId}
                      className={`budget compact ${budgetState(budget)}`}
                    >
                      <span className="name">
                        {categoryName(categories, budget.categoryId)}
                      </span>
                      <BudgetBar share={budgetShare(budget)} />
                      <span className="figure">
                        {budgetFigure(budget, budgets!.currency)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {recent.length > 0 && (
            <section aria-labelledby="overview-recent">
              <div className="section-heading">
                <h2 id="overview-recent">Recent Transactions</h2>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    show({ name: 'transactions', accountId: null })
                  }
                >
                  All Transactions
                </button>
              </div>
              <ul className="list">
                {recent.map((row) => (
                  <li key={row.id} className="list-row recent">
                    <span className="muted">{formatDate(row.date)}</span>
                    <span className="name">{row.description}</span>
                    <span
                      className={`amount${row.amountCents > 0 ? ' positive' : ''}`}
                    >
                      {formatAmount(row.amountCents, row.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
