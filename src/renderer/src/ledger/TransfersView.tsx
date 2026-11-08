import { useEffect, useState } from 'react'
import { formatAmount } from '../../../shared/money'
import type { PossibleTransfer, TransferSide } from '../../../shared/transfers'
import { formatDate } from './format'
import { useLedger } from './store'

/**
 * Pairs that may be one transfer and are not decided: those with competing
 * candidates, and those left by edits or decisions since the last import.
 */
export function TransfersView() {
  const accounts = useLedger((store) => store.accounts)
  const refresh = useLedger((store) => store.refresh)
  const [pairs, setPairs] = useState<PossibleTransfer[] | null>(null)
  const [generation, setGeneration] = useState(0)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let current = true
    window.ledger.transfers.possible().then(
      (found) => current && setPairs(found),
      () => current && setPairs([]),
    )
    return () => {
      current = false
    }
  }, [generation])

  const decide = async (action: () => Promise<{ ok: boolean }>) => {
    try {
      const result = await action()
      setProblem(result.ok ? '' : 'That pair has changed.')
    } catch {
      setProblem('The transfer could not be changed.')
    } finally {
      setGeneration(generation + 1)
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
      {problem && (
        <p className="error import-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="scroll">
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
