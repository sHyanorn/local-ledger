import { useState, type ReactNode } from 'react'
import type { Account } from '../../../shared/ledger'
import { formatAmount } from '../../../shared/money'
import { useVault } from '../store'
import { AccountDialog } from './AccountDialog'
import { useLedger } from './store'

export function Sidebar() {
  const accounts = useLedger((store) => store.accounts)
  const view = useLedger((store) => store.view)
  const transfersToReview = useLedger((store) => store.transfersToReview)
  const overBudget = useLedger((store) => store.overBudget)
  const show = useLedger((store) => store.show)
  const lock = useVault((store) => store.lock)
  const [adding, setAdding] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const active = accounts.filter((account) => !account.archived)
  const archived = accounts.filter((account) => account.archived)
  const viewingArchived =
    view.name === 'transactions' &&
    archived.some((account) => account.id === view.accountId)
  // The group opens whenever an archived account's page is shown, so one
  // archived from its own page stays in view.
  const [wasViewingArchived, setWasViewingArchived] = useState(false)
  if (viewingArchived !== wasViewingArchived) {
    setWasViewingArchived(viewingArchived)
    if (viewingArchived) setShowArchived(true)
  }

  const accountItem = (account: Account) => (
    <li key={account.id}>
      <NavItem
        selected={view.name === 'transactions' && view.accountId === account.id}
        onClick={() => show({ name: 'transactions', accountId: account.id })}
      >
        <span className="name">{account.name}</span>
        <span className="amount">
          {formatAmount(account.balanceCents, account.currency)}
        </span>
      </NavItem>
    </li>
  )

  return (
    <nav className="sidebar" aria-label="Ledger">
      <NavItem
        selected={view.name === 'overview'}
        onClick={() => show({ name: 'overview' })}
      >
        Overview
      </NavItem>
      <NavItem
        selected={view.name === 'transactions' && view.accountId === null}
        onClick={() => show({ name: 'transactions', accountId: null })}
      >
        All Transactions
      </NavItem>
      <NavItem
        selected={view.name === 'budgets'}
        onClick={() => show({ name: 'budgets' })}
      >
        <span className="name">Budgets</span>
        {(overBudget?.length ?? 0) > 0 && (
          <span className="badge over">
            {overBudget?.length}
            <span className="visually-hidden"> over budget</span>
          </span>
        )}
      </NavItem>
      <NavItem
        selected={view.name === 'reports'}
        onClick={() => show({ name: 'reports' })}
      >
        Reports
      </NavItem>
      <NavItem
        selected={view.name === 'transfers'}
        onClick={() => show({ name: 'transfers' })}
      >
        <span className="name">Transfers</span>
        {transfersToReview > 0 && (
          <span className="badge" aria-label={`${transfersToReview} to review`}>
            {transfersToReview}
          </span>
        )}
      </NavItem>

      <div className="sidebar-heading">
        <h2 id="accounts-heading">Accounts</h2>
        <button
          type="button"
          className="icon"
          aria-label="Add Account"
          title="Add Account"
          onClick={() => setAdding(true)}
        >
          +
        </button>
      </div>
      <ul aria-labelledby="accounts-heading">{active.map(accountItem)}</ul>

      {archived.length > 0 && (
        <>
          <div className="sidebar-heading">
            <h2 id="archived-heading">
              <button
                type="button"
                className="sidebar-toggle"
                aria-expanded={showArchived}
                onClick={() => setShowArchived(!showArchived)}
              >
                Archived
              </button>
            </h2>
          </div>
          {showArchived && (
            <ul aria-labelledby="archived-heading">
              {archived.map(accountItem)}
            </ul>
          )}
        </>
      )}

      <div className="sidebar-footer">
        <NavItem
          selected={view.name === 'settings'}
          onClick={() => show({ name: 'settings' })}
        >
          Settings
        </NavItem>
        <NavItem onClick={() => void lock()}>Lock</NavItem>
      </div>

      {adding && <AccountDialog onClose={() => setAdding(false)} />}
    </nav>
  )
}

/** A sidebar button, marked as the current page when selected. */
function NavItem({
  selected = false,
  onClick,
  children,
}: {
  selected?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="sidebar-item"
      aria-current={selected ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
