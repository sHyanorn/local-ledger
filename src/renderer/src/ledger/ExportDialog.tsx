import { useState, type FormEvent } from 'react'
import type { ExportFormat } from '../../../shared/export'
import type { Currency } from '../../../shared/money'
import { Dialog } from '../components/Dialog'
import { formatMonth } from './format'

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'xlsx', label: 'Excel' },
  { value: 'pdf', label: 'PDF' },
]

const PROBLEMS = {
  busy: 'Another export is still running.',
  unwritable: 'The file could not be saved there.',
} as const

/**
 * Exports a month's statement. Says first that the file is unencrypted;
 * the save dialog comes from the main process.
 */
export function ExportDialog({
  month,
  currency,
  onDone,
}: {
  month: string
  currency: Currency
  /** Called with true once a file is saved. */
  onDone: (saved: boolean) => void
}) {
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setWorking(true)
    setProblem(null)
    try {
      const result = await window.ledger.export.save(month, currency, format)
      if (result.ok) return onDone(true)
      if (result.reason === 'cancelled') return setWorking(false)
      setProblem(PROBLEMS[result.reason])
    } catch {
      setProblem('The statement could not be exported.')
    }
    setWorking(false)
  }

  return (
    <Dialog
      title={`Export ${formatMonth(month)}`}
      description={`The exported file is not encrypted. Anyone who has it can read these ${currency} transactions.`}
      onClose={() => onDone(false)}
    >
      <form className="form" onSubmit={(event) => void save(event)}>
        <fieldset className="segmented">
          <legend>Format</legend>
          {FORMATS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="export-format"
                value={option.value}
                checked={format === option.value}
                onChange={() => setFormat(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => onDone(false)}
          >
            Cancel
          </button>
          <button type="submit" disabled={working}>
            {working ? 'Exporting…' : 'Export…'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
