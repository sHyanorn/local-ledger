import { useState } from 'react'
import type { Transaction } from '../../../shared/ledger'
import { formatAmount } from '../../../shared/money'
import type { TransferSide } from '../../../shared/transfers'
import { formatDate } from './format'
import { useLedger } from './store'

/**
 * A saved transaction's transfer: the account on the other side, with a way
 * to split it; or, unpaired, a way to pair it with the other side by hand.
 */
export function TransferField({
  transaction,
  onChanged,
}: {
  transaction: Transaction
  onChanged: () => void
}) {
  const accounts = useLedger((store) => store.accounts)
  const [choices, setChoices] = useState<TransferSide[] | null>(null)
  const [choice, setChoice] = useState<number | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const name = (id: number) =>
    accounts.find((account) => account.id === id)?.name

  const run = async (action: () => Promise<{ ok: boolean }>) => {
    try {
      const result = await action()
      if (!result.ok) return setProblem('The transfer has changed. Try again.')
      onChanged()
    } catch {
      setProblem('The transfer could not be changed.')
    }
  }

  if (transaction.transferAccountId !== null) {
    return (
      <div className="transfer-field">
        <span>Transfer with {name(transaction.transferAccountId)}</span>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void run(() => window.ledger.transfers.unlink(transaction.id))
          }
        >
          Not a Transfer
        </button>
        {problem && <p className="error">{problem}</p>}
      </div>
    )
  }

  if (transaction.amountCents === 0) return null
  if (choices === null) {
    return (
      <div className="transfer-field">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            window.ledger.transfers.choices(transaction.id).then(
              (found) => {
                setChoices(found)
                setChoice(found[0]?.id ?? null)
              },
              () => setProblem('The transfers could not be loaded.'),
            )
          }
        >
          Pair as Transfer…
        </button>
        {problem && <p className="error">{problem}</p>}
      </div>
    )
  }
  if (choices.length === 0) {
    return (
      <p className="muted transfer-field">
        No other account has the opposite amount.
      </p>
    )
  }
  return (
    <div className="transfer-field">
      <select
        aria-label="Other side of the transfer"
        value={choice ?? ''}
        onChange={(event) => setChoice(Number(event.target.value))}
      >
        {choices.map((side) => (
          <option key={side.id} value={side.id}>
            {name(side.accountId)} · {formatDate(side.date)} ·{' '}
            {side.description} ·{' '}
            {formatAmount(side.amountCents, transaction.currency)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="secondary"
        disabled={choice === null}
        onClick={() =>
          choice !== null &&
          void run(() => window.ledger.transfers.link(transaction.id, choice))
        }
      >
        Pair
      </button>
      {problem && <p className="error">{problem}</p>}
    </div>
  )
}
