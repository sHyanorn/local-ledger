import { useState } from 'react'
import type { FormEvent } from 'react'
import { Confirm, Dialog } from '../components/Dialog'
import { ErrorText } from '../components/ErrorText'
import { ACCOUNT_TYPES, NAME_MAX } from '../../../shared/ledger'
import type { Account, AccountType } from '../../../shared/ledger'
import { centsToDecimal, CURRENCIES, parseAmount } from '../../../shared/money'
import type { Currency } from '../../../shared/money'
import { useLedger } from './store'
import { count } from './format'

const TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Bank',
  savings: 'Savings',
  credit: 'Credit card',
  cash: 'Cash',
}

const PROBLEMS: Record<string, string> = {
  duplicate: 'An account with this name already exists.',
  'currency-in-use': 'An account with transactions keeps its currency.',
  'not-found': 'This account no longer exists.',
  failed: 'The account could not be saved.',
}

/** Creates an account, or with `account`, edits or deletes it. */
export function AccountDialog({
  account,
  onClose,
}: {
  account?: Account
  onClose: () => void
}) {
  const refresh = useLedger((store) => store.refresh)
  const show = useLedger((store) => store.show)
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'bank')
  const [currency, setCurrency] = useState<Currency>(account?.currency ?? 'AUD')
  const [opening, setOpening] = useState(
    account ? centsToDecimal(account.openingBalanceCents) : '',
  )
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const openingBalanceCents = opening.trim() === '' ? 0 : parseAmount(opening)
    if (!name.trim()) return setProblem('Enter a name.')
    if (openingBalanceCents === null) {
      return setProblem(
        'Enter the opening balance as an amount, such as 1250.00.',
      )
    }
    setBusy(true)
    try {
      const fields = { name, type, currency, openingBalanceCents }
      if (account) {
        const result = await window.ledger.accounts.update({
          id: account.id,
          ...fields,
        })
        if (!result.ok) return setProblem(PROBLEMS[result.reason] ?? null)
        await refresh()
      } else {
        const result = await window.ledger.accounts.create(fields)
        if (!result.ok) return setProblem(PROBLEMS[result.reason] ?? null)
        await refresh()
        // A new account opens, to add its transactions.
        show({ name: 'transactions', accountId: result.id })
      }
      onClose()
    } catch {
      setProblem(PROBLEMS.failed)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!account) return
    try {
      const result = await window.ledger.accounts.delete(account.id)
      if (!result.ok) return setProblem(PROBLEMS[result.reason] ?? null)
      await refresh()
      onClose()
    } catch {
      setProblem('The account could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  if (deleting && account) {
    return account.transactionCount > 0 ? (
      <Confirm
        title="Account in use"
        message={`“${account.name}” has ${count(account.transactionCount, 'transaction')}. Delete or move them before deleting the account.`}
        onCancel={() => setDeleting(false)}
      />
    ) : (
      <Confirm
        title="Delete account?"
        message={`“${account.name}” will be deleted. This cannot be undone.`}
        action="Delete"
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(false)}
      />
    )
  }

  return (
    <Dialog title={account ? 'Edit Account' : 'New Account'} onClose={onClose}>
      <form className="form" onSubmit={save} noValidate>
        <label>
          Name
          <input
            value={name}
            maxLength={NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </label>
        <div className="row">
          <label>
            Type
            <select
              value={type}
              onChange={(event) => setType(event.target.value as AccountType)}
            >
              {ACCOUNT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Currency
            <select
              value={currency}
              disabled={(account?.transactionCount ?? 0) > 0}
              onChange={(event) => setCurrency(event.target.value as Currency)}
            >
              {CURRENCIES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Opening balance
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={opening}
            onChange={(event) => setOpening(event.target.value)}
          />
        </label>
        <ErrorText message={problem} />
        <div className="actions">
          {account && (
            <button
              type="button"
              className="secondary destructive"
              onClick={() => setDeleting(true)}
            >
              Delete Account…
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {account ? 'Save' : 'Add Account'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
