import { useEffect, useState, type FormEvent } from 'react'
import type { BackupSummary } from '../../../shared/backup'
import { PASSWORD_MAX, passwordLength } from '../../../shared/password'
import { Dialog } from '../components/Dialog'
import { ErrorText } from '../components/ErrorText'
import { formatDate } from '../ledger/format'
import { count } from '../ledger/format'

const BUSY = 'Another restore is still running.'

const OPEN_PROBLEMS = {
  busy: BUSY,
  'too-large': 'The file is too large to be a backup.',
  unreadable: 'The file could not be read.',
  invalid: 'The file is not a Local Ledger backup, or it is damaged.',
} as const

const CHECK_PROBLEMS = {
  'no-file': 'Choose the backup again.',
  busy: BUSY,
  invalid: OPEN_PROBLEMS.invalid,
  'wrong-password': 'Wrong password for this backup.',
  newer: 'This backup was made by a newer version of Local Ledger.',
  damaged: 'The backup is damaged.',
} as const

const COMMIT_PROBLEMS = {
  'not-checked': 'Choose the backup again.',
  busy: BUSY,
  'wrong-password': 'Wrong current password.',
  exists: 'A vault already exists here.',
  damaged: 'The vault could not be replaced.',
} as const

/**
 * Restores a backup: choose the file, open it with its password, then
 * confirm. From Settings (`replacing`) the current password is asked for
 * and kept; otherwise the backup's password becomes the vault's, also from
 * the locked page (`locked`), where the vault moved aside is not opened. On
 * success the main process shows the restored vault in a new page.
 */
export function RestoreDialog({
  replacing,
  locked = false,
  onClose,
}: {
  replacing: boolean
  locked?: boolean
  onClose: () => void
}) {
  const [name, setName] = useState<string | null>(null)
  const [summary, setSummary] = useState<BackupSummary | null>(null)
  const [password, setPassword] = useState('')
  const [current, setCurrent] = useState('')
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // What the main process holds for this dialog goes when it closes.
  useEffect(
    () => () => {
      void window.ledger.restore.discard().catch(() => undefined)
    },
    [],
  )

  const run = async (step: () => Promise<void>) => {
    setWorking(true)
    setProblem(null)
    try {
      await step()
    } catch {
      setProblem('The backup could not be restored.')
    } finally {
      setWorking(false)
    }
  }

  const choose = () =>
    run(async () => {
      const result = await window.ledger.restore.open()
      if (result.ok) {
        setName(result.name)
        setSummary(null)
      } else if (result.reason !== 'cancelled') {
        setProblem(OPEN_PROBLEMS[result.reason])
      }
    })

  const check = (event: FormEvent) => {
    event.preventDefault()
    if (!password) return
    if (passwordLength(password) > PASSWORD_MAX) {
      setPassword('')
      return setProblem(CHECK_PROBLEMS['wrong-password'])
    }
    void run(async () => {
      const result = await window.ledger.restore.check(password)
      setPassword('')
      if (result.ok) setSummary(result.summary)
      else setProblem(CHECK_PROBLEMS[result.reason])
    })
  }

  const restore = (event: FormEvent) => {
    event.preventDefault()
    if (replacing && !current) return
    void run(async () => {
      const result = await window.ledger.restore.commit(
        replacing ? current : null,
      )
      setCurrent('')
      // On success this page is replaced.
      if (!result.ok) setProblem(COMMIT_PROBLEMS[result.reason])
    })
  }

  const close = () => {
    if (!working) onClose()
  }

  const contents = summary
    ? `${count(summary.accounts, 'account')} and ${count(summary.transactions, 'transaction')}${summary.lastDate ? `, the latest on ${formatDate(summary.lastDate)}` : ''}`
    : null

  return (
    <Dialog title="Restore from Backup" onClose={close}>
      {!summary ? (
        <form className="form" onSubmit={check}>
          <div className="file-choice">
            <button
              type="button"
              className="secondary"
              onClick={() => void choose()}
              disabled={working}
            >
              Choose Backup…
            </button>
            <span className="muted">{name ?? 'No file chosen'}</span>
          </div>
          {name && (
            <label>
              Backup password
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={working}
                autoFocus
              />
            </label>
          )}
          <ErrorText message={problem} />
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={close}
              disabled={working}
            >
              Cancel
            </button>
            <button type="submit" disabled={working || !name || !password}>
              {working ? 'Opening…' : 'Open Backup'}
            </button>
          </div>
        </form>
      ) : (
        <form className="form" onSubmit={restore}>
          <p>The backup holds {contents}.</p>
          {replacing ? (
            <p className="consequence">
              Restoring replaces everything in this vault with the backup. The
              current vault is moved to a folder named vault-before-restore
              beside it, and not deleted. The restored vault keeps your current
              master password.
            </p>
          ) : locked ? (
            <p className="consequence">
              The current vault is moved to a folder named vault-before-restore
              beside it, and not deleted. The restored vault opens with the
              backup&apos;s master password.
            </p>
          ) : (
            <p className="consequence">
              The restored vault opens with the backup&apos;s master password.
              You can change it in Settings.
            </p>
          )}
          {replacing && (
            <label>
              Current master password
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                disabled={working}
                autoFocus
              />
            </label>
          )}
          <ErrorText message={problem} />
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={close}
              disabled={working}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={replacing || locked ? 'danger' : undefined}
              disabled={working || (replacing && !current)}
            >
              {working ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
