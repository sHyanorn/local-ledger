import { useEffect } from 'react'
import { BudgetsView } from './BudgetsView'
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

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="ledger">
      <Sidebar />
      <main className="main">
        {view.name === 'settings' ? (
          <Settings />
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
      </main>
    </div>
  )
}
