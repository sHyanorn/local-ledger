import { useEffect, useState } from 'react'
import { isoDate } from '../../../shared/dates'
import type { ImportBatch } from '../../../shared/imports'
import { Confirm } from '../components/Dialog'
import { count, formatDate } from './format'
import { useLedger } from './store'

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
              {formatDate(isoDate(new Date(batch.importedAt)))} ·{' '}
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

/** What undoing removes, including the transactions changed since, and what it keeps. */
function undoMessage(batch: ImportBatch): string {
  const changed =
    batch.edited > 0
      ? `, including ${batch.edited.toLocaleString('en-AU')} you have changed`
      : ''
  const paired =
    batch.paired === 1
      ? ' 1 of them is paired as a transfer, which will be unpaired.'
      : batch.paired > 1
        ? ` ${batch.paired.toLocaleString('en-AU')} of them are paired as transfers, which will be unpaired.`
        : ''
  const kept =
    batch.kept === 1
      ? ' 1 other stays, because a later import also contained it.'
      : batch.kept > 1
        ? ` ${batch.kept.toLocaleString('en-AU')} others stay, because a later import also contained them.`
        : ''
  return `${count(batch.count - batch.kept, 'transaction')} from “${batch.fileName}” will be deleted${changed}.${paired}${kept}`
}
