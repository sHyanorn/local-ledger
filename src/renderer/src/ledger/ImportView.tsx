import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ImportRequest } from '../../../shared/api'
import type {
  Encoding,
  ImportFile,
  ImportPreview,
  ImportTarget,
  Mapping,
} from '../../../shared/imports'
import { count } from './format'
import { FILE_PROBLEMS, rowProblem, TEMPLATE_NAMES } from './importing'
import { ErrorText } from '../components/ErrorText'
import { useLedger } from './store'
import { ColumnEditor } from './ColumnEditor'
import { PreviewRows } from './PreviewRows'

/** Why a preview or an import was refused. */
const IMPORT_PROBLEMS = {
  ...FILE_PROBLEMS,
  'not-found': 'The file is no longer open. Choose it again.',
  nothing: 'No rows are selected.',
  changed: 'The rows changed. Check them and import again.',
}

/** Columns to start from when nothing about the file could be told. */
function fallbackMapping(columns: number): Mapping {
  const last = Math.max(0, columns - 1)
  return {
    header: false,
    date: 0,
    dateOrder: 'dmy',
    description: [Math.min(2, last)],
    amount: { kind: 'signed', column: Math.min(1, last), negate: false },
  }
}

export function ImportView({
  file,
  accountId,
}: {
  file: ImportFile
  accountId: number | null
}) {
  const accounts = useLedger((store) => store.accounts)
  const show = useLedger((store) => store.show)
  const refresh = useLedger((store) => store.refresh)
  const setNotice = useLedger((store) => store.setNotice)
  const [encoding, setEncoding] = useState<Encoding>(file.encoding)
  const [mapping, setMapping] = useState<Mapping>(
    file.mapping ?? fallbackMapping(file.columns),
  )
  // Opens when the columns are unknown, or the dates fit more than one order.
  const [editingColumns, setEditingColumns] = useState(
    file.mapping === null || file.dateOrders.length > 1,
  )
  const [targets, setTargets] = useState<ImportTarget[]>(() =>
    file.groups
      ? file.groups.map((group) => ({ key: group.key, accountId: null }))
      : [{ key: '', accountId }],
  )
  // The preview shown, and the settings it was made with.
  const [answer, setAnswer] = useState<{
    request: ImportRequest
    preview: ImportPreview
  } | null>(null)
  const [problem, setProblem] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [importing, setImporting] = useState(false)

  const request = useMemo(
    (): ImportRequest => ({ id: file.id, encoding, mapping, targets }),
    [file.id, encoding, mapping, targets],
  )
  const anyTarget = targets.some((target) => target.accountId !== null)
  // With every account skipped there is nothing to show.
  const preview = anyTarget ? (answer?.preview ?? null) : null
  // Rows are chosen by their place in a preview; until the preview for the
  // current settings arrives, the selection belongs to other rows.
  const current = anyTarget && answer?.request === request

  // Each change reads the file again; an older answer that arrives late is dropped.
  const generation = useRef(0)
  useEffect(() => {
    if (!anyTarget) return
    const current = ++generation.current
    window.ledger.imports.preview(request).then(
      (result) => {
        if (current !== generation.current) return
        if (!result.ok) {
          setAnswer(null)
          setSelected(new Set())
          setProblem(IMPORT_PROBLEMS[result.reason])
          return
        }
        setProblem('')
        setAnswer({ request, preview: result.preview })
        setSelected(
          new Set(
            result.preview.rows
              .filter((row) => row.status === 'new')
              .map((row) => row.index),
          ),
        )
      },
      () => {
        if (current === generation.current) {
          setProblem('The file could not be read.')
        }
      },
    )
  }, [request, anyTarget])

  const shown = useMemo(
    () => preview?.rows.filter((row) => row.status !== 'duplicate') ?? [],
    [preview],
  )
  const duplicates = (preview?.rows.length ?? 0) - shown.length
  const possible = shown.filter((row) => row.status === 'possible').length
  const currencies = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.currency])),
    [accounts],
  )
  const names = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts],
  )

  const close = () => {
    void window.ledger.imports.discard(file.id)
    show({ name: 'transactions', accountId })
  }

  const commit = async () => {
    setImporting(true)
    try {
      const result = await window.ledger.imports.commit(request, [...selected])
      if (!result.ok) {
        setProblem(IMPORT_PROBLEMS[result.reason])
        return
      }
      await refresh()
      setNotice(
        [
          `Imported ${count(result.count, 'transaction')}.`,
          result.paired > 0 && `${count(result.paired, 'transfer')} paired.`,
        ]
          .filter(Boolean)
          .join(' '),
      )
      const single = targets.filter((target) => target.accountId !== null)
      show({
        name: 'transactions',
        accountId: single.length === 1 ? (single[0]?.accountId ?? null) : null,
      })
    } catch {
      setProblem('The rows could not be imported.')
    } finally {
      setImporting(false)
    }
  }

  const toggle = useCallback((index: number, on: boolean) => {
    setSelected((before) => {
      const next = new Set(before)
      if (on) next.add(index)
      else next.delete(index)
      return next
    })
  }, [])
  const allSelected =
    shown.length > 0 && shown.every((row) => selected.has(row.index))

  return (
    <div className="content">
      <header className="toolbar">
        <h1>Import {file.fileName}</h1>
        <div className="actions">
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            disabled={importing || !current || selected.size === 0}
            onClick={() => void commit()}
          >
            {selected.size > 0
              ? `Import ${count(selected.size, 'Transaction')}`
              : 'Import'}
          </button>
        </div>
      </header>

      <div className="import-setup">
        {file.groups ? (
          <fieldset className="targets">
            <legend>Accounts</legend>
            {file.groups.map((group, index) => (
              <label key={group.key}>
                <span>
                  {group.key === '' ? 'No account' : `Account ${group.key}`}
                  <span className="muted"> · {count(group.rows, 'row')}</span>
                </span>
                <AccountSelect
                  value={targets[index]?.accountId ?? null}
                  skippable
                  onChange={(value) =>
                    setTargets(
                      targets.map((target, at) =>
                        at === index ? { ...target, accountId: value } : target,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </fieldset>
        ) : (
          <label className="inline-field">
            Account
            <AccountSelect
              value={targets[0]?.accountId ?? null}
              onChange={(value) => setTargets([{ key: '', accountId: value }])}
            />
          </label>
        )}
        <div className="setup-end">
          <span className="muted">
            {file.template
              ? `${TEMPLATE_NAMES[file.template]} format`
              : 'Other format'}
          </span>
          <button
            type="button"
            className="secondary"
            aria-expanded={editingColumns}
            onClick={() => setEditingColumns(!editingColumns)}
          >
            Columns…
          </button>
        </div>
      </div>

      {editingColumns && (
        <ColumnEditor
          file={file}
          mapping={mapping}
          encoding={encoding}
          onMapping={setMapping}
          onEncoding={setEncoding}
        />
      )}

      <ErrorText message={problem} className="import-problem" />

      {preview && (
        <p className="import-summary" aria-live="polite">
          {[
            (shown.length - possible > 0 || possible === 0) &&
              count(shown.length - possible, 'new transaction'),
            possible > 0 && count(possible, 'possible duplicate'),
            duplicates > 0 && `${count(duplicates, 'row')} already imported`,
            preview.errors.length > 0 &&
              `${count(preview.errors.length, 'row')} not readable`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      {preview && (
        <div
          className="table"
          role="table"
          aria-label="Rows to import"
          aria-busy={!current}
          aria-rowcount={shown.length + 1}
        >
          <div
            className={`tr head preview${file.groups ? ' with-account' : ''}`}
            role="row"
          >
            <span role="columnheader">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allSelected}
                disabled={shown.length === 0}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? new Set(shown.map((row) => row.index))
                      : new Set(),
                  )
                }
              />
            </span>
            <span role="columnheader">Date</span>
            <span role="columnheader">Description</span>
            <span role="columnheader">Category</span>
            {file.groups && <span role="columnheader">Account</span>}
            <span role="columnheader" className="amount">
              Amount
            </span>
            <span role="columnheader">Matches</span>
          </div>
          <PreviewRows
            rows={shown}
            selected={selected}
            onToggle={toggle}
            groups={file.groups !== null}
            currencies={currencies}
            names={names}
          />
        </div>
      )}

      {preview && preview.errors.length > 0 && (
        <details className="import-errors">
          <summary>{count(preview.errors.length, 'row')} not readable</summary>
          <ul>
            {preview.errors.map((error) => (
              <li key={error.line}>
                Line {error.line}: {rowProblem(error)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function AccountSelect({
  value,
  skippable = false,
  onChange,
}: {
  value: number | null
  skippable?: boolean
  onChange: (value: number | null) => void
}) {
  const accounts = useLedger((store) => store.accounts)
  return (
    <select
      value={value ?? ''}
      onChange={(event) =>
        onChange(event.target.value === '' ? null : Number(event.target.value))
      }
    >
      {(skippable || value === null) && (
        <option value="">{skippable ? 'Skip' : 'Choose…'}</option>
      )}
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
    </select>
  )
}
