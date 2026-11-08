import { useEffect, useRef, useState, type DragEvent } from 'react'
import { dropImportFile } from './importing'
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
  const show = useLedger((store) => store.show)
  const setNotice = useLedger((store) => store.setNotice)
  const [dragging, setDragging] = useState(false)
  // Enter and leave fire for every child; count them to know when it left.
  const depth = useRef(0)

  const carriesFile = (event: DragEvent) =>
    event.dataTransfer.types.includes('Files')
  const dragEnter = (event: DragEvent) => {
    if (!carriesFile(event)) return
    depth.current++
    setDragging(true)
  }
  const dragLeave = (event: DragEvent) => {
    if (!carriesFile(event)) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }
  const dragOver = (event: DragEvent) => {
    if (!carriesFile(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  const drop = async (event: DragEvent) => {
    if (!carriesFile(event)) return
    event.preventDefault()
    depth.current = 0
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    const accountId = view.name === 'transactions' ? view.accountId : null
    try {
      const dropped = await dropImportFile(file)
      if ('file' in dropped) {
        show({ name: 'import', file: dropped.file, accountId })
        return
      }
      setNotice(dropped.problem)
    } catch {
      setNotice('The file could not be opened.')
    }
    show({ name: 'transactions', accountId })
  }

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div
      className="ledger"
      onDragEnter={dragEnter}
      onDragLeave={dragLeave}
      onDragOver={dragOver}
      onDrop={(event) => void drop(event)}
    >
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
      {dragging && (
        <div className="drop-target" aria-hidden="true">
          <p>Drop a CSV file to import it</p>
        </div>
      )}
    </div>
  )
}
