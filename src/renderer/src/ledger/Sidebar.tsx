import { useState } from 'react'
import { formatAmount } from '../../../shared/money'
import { useVault } from '../store'
import { AccountDialog } from './AccountDialog'
import { useLedger } from './store'

export function Sidebar() {
  const accounts = useLedger((store) => store.accounts)
  const view = useLedger((store) => store.view)
  const transfersToReview = useLedger((store) => store.transfersToReview)
  const show = useLedger((store) => store.show)
  const lock = useVault((store) => store.lock)
  const [adding, setAdding] = useState(false)

  const current = (selected: boolean) => (selected ? 'page' : undefined)

  return (
    <nav className="sidebar" aria-label="Ledger">
      <button
        type="button"
        className="sidebar-item"
        aria-current={current(
          view.name === 'transactions' && view.accountId === null,
        )}
        onClick={() => show({ name: 'transactions', accountId: null })}
      >
        All Transactions
      </button>
      <button
        type="button"
        className="sidebar-item"
        aria-current={current(view.name === 'transfers')}
        onClick={() => show({ name: 'transfers' })}
      >
        <span className="name">Transfers</span>
        {transfersToReview > 0 && (
          <span className="badge" aria-label={`${transfersToReview} to review`}>
            {transfersToReview}
          </span>
        )}
      </button>

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
            <button
              type="button"
              className="sidebar-item"
              aria-current={current(
                view.name === 'transactions' && view.accountId === account.id,
              )}
              onClick={() =>
                show({ name: 'transactions', accountId: account.id })
              }
            >
              <span className="name">{account.name}</span>
              <span className="amount">
                {formatAmount(account.balanceCents, account.currency)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-item"
          aria-current={current(view.name === 'settings')}
          onClick={() => show({ name: 'settings' })}
        >
          Settings
        </button>
        <button
          type="button"
          className="sidebar-item"
          onClick={() => void lock()}
        >
          Lock
        </button>
      </div>

      {adding && <AccountDialog onClose={() => setAdding(false)} />}
    </nav>
  )
}
