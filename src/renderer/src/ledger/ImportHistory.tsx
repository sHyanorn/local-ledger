import { useEffect, useState } from 'react'
import type { ImportBatch } from '../../../shared/imports'
import { Confirm } from '../components/Dialog'
import { formatDate } from './format'
import { count, useLedger } from './store'

/** Past imports, newest first, each of which can be undone. */
export function ImportHistory() {
  const refreshLedger = useLedger((store) => store.refresh)
  const [batches, setBatches] = useState<ImportBatch[] | null>(null)
  const [undoing, setUndoing] = useState<ImportBatch | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let current = true
    window.ledger.imports.batches().then(
      (list) => current && setBatches(list),
      () => current && setBatches([]),
    )
    return () => {
      current = false
    }
  }, [generation])

  const undo = async (batch: ImportBatch) => {
    setUndoing(null)
    try {
      await window.ledger.imports.undo(batch.id)
    } finally {
      setGeneration(generation + 1)
      void refreshLedger()
    }
  }

  if (!batches || batches.length === 0) return null
  return (
    <section aria-labelledby="imports-heading">
      <h2 id="imports-heading">Imports</h2>
      <ul className="list">
        {batches.map((batch) => (
          <li key={batch.id} className="list-row">
            <span className="name">{batch.fileName}</span>
            <span className="muted">
              {formatDate(batch.importedAt.slice(0, 10))} ·{' '}
              {count(batch.count, 'transaction')}
            </span>
            <button
              type="button"
              className="secondary"
              onClick={() => setUndoing(batch)}
            >
              Undo…
            </button>
          </li>
        ))}
      </ul>
      {undoing && (
        <Confirm
          title="Undo Import?"
          message={undoMessage(undoing)}
          action="Undo Import"
          onConfirm={() => void undo(undoing)}
          onCancel={() => setUndoing(null)}
        />
      )}
    </section>
  )
}

/** What undoing removes, including the transactions changed since. */
function undoMessage(batch: ImportBatch): string {
  const changed =
    batch.edited > 0
      ? `, including ${count(batch.edited, 'one', 'ones')} you have changed`
      : ''
  return `${count(batch.count, 'transaction')} from “${batch.fileName}” will be deleted${changed}.`
}
