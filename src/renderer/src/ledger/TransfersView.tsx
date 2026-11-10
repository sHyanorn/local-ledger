import { useState } from 'react'
import { formatAmount } from '../../../shared/money'
import type { TransferSide } from '../../../shared/transfers'
import { formatDate } from './format'
import { useLedger } from './store'
import { useLoaded } from './useLoaded'
import { ErrorText } from '../components/ErrorText'

/**
 * Pairs that may be one transfer and are not decided: those with competing
 * candidates, and those left by edits or decisions since the last import.
 */
export function TransfersView() {
  const accounts = useLedger((store) => store.accounts)
  const refresh = useLedger((store) => store.refresh)
  const { value: pairs, failed } = useLoaded(
    () => window.ledger.transfers.possible(),
    [],
  )
  const [problem, setProblem] = useState('')

  const decide = async (action: () => Promise<{ ok: boolean }>) => {
    try {
      const result = await action()
      setProblem(result.ok ? '' : 'That pair has changed.')
    } catch {
      setProblem('The transfer could not be changed.')
    } finally {
      // Reloading the ledger loads the pairs again.
      void refresh()
    }
  }

  const side = (entry: TransferSide) => {
    const account = accounts.find((option) => option.id === entry.accountId)
    return (
      <div className="transfer-side">
        <span className="name">{account?.name}</span>
        <span className="muted">
          {formatDate(entry.date)} · {entry.description}
        </span>
        <span className={`amount${entry.amountCents > 0 ? ' positive' : ''}`}>
          {account && formatAmount(entry.amountCents, account.currency)}
        </span>
      </div>
    )
  }

  return (
    <div className="content">
      <header className="toolbar">
        <h1>Transfers</h1>
      </header>
      <ErrorText message={problem} className="import-problem" />
      <div className="scroll">
        {failed && <p className="empty">The transfers could not be loaded.</p>}
        {pairs && pairs.length === 0 && (
          <p className="empty">No transfers to review</p>
        )}
        {pairs && pairs.length > 0 && (
          <ul className="transfers" aria-label="Possible transfers">
            {pairs.map((pair) => (
              <li key={`${pair.out.id}:${pair.in.id}`}>
                {side(pair.out)}
                {side(pair.in)}
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`Not a transfer: ${pair.out.description} and ${pair.in.description}`}
                    onClick={() =>
                      void decide(() =>
                        window.ledger.transfers.reject(pair.out.id, pair.in.id),
                      )
                    }
                  >
                    Not a Transfer
                  </button>
                  <button
                    type="button"
                    aria-label={`Pair ${pair.out.description} with ${pair.in.description}`}
                    onClick={() =>
                      void decide(() =>
                        window.ledger.transfers.link(pair.out.id, pair.in.id),
                      )
                    }
                  >
                    Pair
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
