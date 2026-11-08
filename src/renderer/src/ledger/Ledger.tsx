import { useEffect } from 'react'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { useLedger } from './store'
import { Transactions } from './Transactions'

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
        ) : (
          <Transactions accountId={view.accountId} />
        )}
      </main>
    </div>
  )
}
