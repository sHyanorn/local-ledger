import { useState } from 'react'
import { AccountDialog } from './AccountDialog'
import { useLedger } from './store'

export function Transactions({ accountId }: { accountId: number | null }) {
  const account = useLedger((store) =>
    store.accounts.find((candidate) => candidate.id === accountId),
  )
  const [editing, setEditing] = useState(false)

  return (
    <div className="content">
      <header className="toolbar">
        <h1>{account?.name ?? 'All Transactions'}</h1>
        {account && (
          <button
            type="button"
            className="secondary"
            onClick={() => setEditing(true)}
          >
            Edit Account…
          </button>
        )}
      </header>
      {editing && account && (
        <AccountDialog account={account} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}
