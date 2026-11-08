import { useState } from 'react'
import type { FormEvent } from 'react'
import { Confirm, Dialog } from '../components/Dialog'
import { isIsoDate, isoDate } from '../../../shared/dates'
import { DESCRIPTION_MAX, NOTES_MAX } from '../../../shared/ledger'
import type { Transaction } from '../../../shared/ledger'
import {
  centsToDecimal,
  formatAmount,
  parseAmount,
} from '../../../shared/money'
import { formatDate } from './format'
import { CategoryOptions } from './CategoryOptions'
import { useLedger } from './store'

/**
 * Adds a transaction, or with `transaction`, edits or deletes it. Amounts
 * are entered as positive numbers, with the direction chosen separately.
 */
export function TransactionDialog({
  transaction,
  accountId,
  onSaved,
  onClose,
}: {
  transaction?: Transaction
  /** The account a new transaction starts in. */
  accountId?: number
  onSaved: () => void
  onClose: () => void
}) {
  const accounts = useLedger((store) => store.accounts)
  const [account, setAccount] = useState(
    transaction?.accountId ?? accountId ?? accounts[0]?.id ?? 0,
  )
  const [date, setDate] = useState(
    () => transaction?.date ?? isoDate(new Date()),
  )
  const [description, setDescription] = useState(transaction?.description ?? '')
  const [moneyIn, setMoneyIn] = useState((transaction?.amountCents ?? -1) > 0)
  const [amount, setAmount] = useState(
    transaction ? centsToDecimal(Math.abs(transaction.amountCents)) : '',
  )
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? null)
  const [notes, setNotes] = useState(transaction?.notes ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const cents = parseAmount(amount)
    if (!description.trim()) return setProblem('Enter a description.')
    if (!isIsoDate(date)) return setProblem('Enter a date.')
    if (cents === null || cents <= 0) {
      return setProblem('Enter the amount as a positive number, such as 12.50.')
    }
    setBusy(true)
    try {
      const fields = {
        accountId: account,
        date,
        amountCents: moneyIn ? cents : -cents,
        description,
        categoryId,
        notes,
      }
      const result = transaction
        ? await window.ledger.transactions.update({
            id: transaction.id,
            ...fields,
          })
        : await window.ledger.transactions.create(fields)
      if (!result.ok) {
        return setProblem('The account or category no longer exists.')
      }
      onSaved()
      onClose()
    } catch {
      setProblem('The transaction could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!transaction) return
    try {
      await window.ledger.transactions.delete(transaction.id)
      onSaved()
      onClose()
    } catch {
      setDeleting(false)
      setProblem('The transaction could not be deleted.')
    }
  }

  if (deleting && transaction) {
    return (
      <Confirm
        title="Delete transaction?"
        message={`“${transaction.description}” on ${formatDate(transaction.date)}, ${formatAmount(transaction.amountCents, transaction.currency)}, will be deleted. This cannot be undone.`}
        action="Delete"
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(false)}
      />
    )
  }

  return (
    <Dialog
      title={transaction ? 'Edit Transaction' : 'New Transaction'}
      onClose={onClose}
    >
      <form className="form" onSubmit={save} noValidate>
        <label>
          Description
          <input
            value={description}
            maxLength={DESCRIPTION_MAX}
            onChange={(event) => setDescription(event.target.value)}
            autoFocus
          />
        </label>
        <div className="row">
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            Account
            <select
              value={account}
              onChange={(event) => setAccount(Number(event.target.value))}
            >
              {accounts.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <fieldset className="segmented">
            <legend>Direction</legend>
            <label>
              <input
                type="radio"
                name="direction"
                checked={!moneyIn}
                onChange={() => setMoneyIn(false)}
              />
              Money out
            </label>
            <label>
              <input
                type="radio"
                name="direction"
                checked={moneyIn}
                onChange={() => setMoneyIn(true)}
              />
              Money in
            </label>
          </fieldset>
          <label>
            Amount
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
        </div>
        <label>
          Category
          <select
            value={categoryId ?? ''}
            onChange={(event) =>
              setCategoryId(
                event.target.value === '' ? null : Number(event.target.value),
              )
            }
          >
            <option value="">Uncategorized</option>
            <CategoryOptions />
          </select>
        </label>
        <label>
          Notes
          <textarea
            rows={2}
            value={notes}
            maxLength={NOTES_MAX}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <div className="actions">
          {transaction && (
            <button
              type="button"
              className="secondary destructive"
              onClick={() => setDeleting(true)}
            >
              Delete…
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {transaction ? 'Save' : 'Add Transaction'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
