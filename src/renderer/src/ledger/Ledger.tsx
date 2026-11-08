import { useEffect } from 'react'
import { BudgetsView } from './BudgetsView'
import { OverviewView } from './OverviewView'
import { ReportsView } from './ReportsView'
import { ImportView } from './ImportView'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { useLedger } from './store'
import { Transactions } from './Transactions'
import { TransfersView } from './TransfersView'

/** The unlocked vault: accounts in a sidebar, the selected view beside it. */
export function Ledger() {
  const view = useLedger((store) => store.view)
  const refresh = useLedger((store) => store.refresh)
  const budgetNotice = useLedger((store) => store.budgetNotice)
  const setBudgetNotice = useLedger((store) => store.setBudgetNotice)

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="ledger">
      <Sidebar />
      <main className="main">
        <div className="view">
          {view.name === 'settings' ? (
            <Settings />
          ) : view.name === 'overview' ? (
            <OverviewView />
          ) : view.name === 'reports' ? (
            <ReportsView />
          ) : view.name === 'budgets' ? (
            <BudgetsView />
          ) : view.name === 'transfers' ? (
            <TransfersView />
          ) : view.name === 'import' ? (
            <ImportView
              key={view.file.id}
              file={view.file}
              accountId={view.accountId}
            />
          ) : (
            <Transactions accountId={view.accountId} />
          )}
        </div>
        <div aria-live="polite">
          {budgetNotice && (
            <div
              className="suggestion"
              role="region"
              aria-label="Budget notice"
            >
              <p>{budgetNotice}</p>
              <button
                type="button"
                className="icon"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={() => setBudgetNotice(null)}
              >
                ×
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
