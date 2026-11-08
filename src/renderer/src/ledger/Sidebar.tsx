import { useState, type ReactNode } from 'react'
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
      <ul aria-labelledby="accounts-heading">
        {accounts.map((account) => (
          <li key={account.id}>
            <NavItem
              selected={
                view.name === 'transactions' && view.accountId === account.id
              }
              onClick={() =>
                show({ name: 'transactions', accountId: account.id })
              }
            >
              <span className="name">{account.name}</span>
              <span className="amount">
                {formatAmount(account.balanceCents, account.currency)}
              </span>
            </NavItem>
          </li>
        ))}
      </ul>

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
