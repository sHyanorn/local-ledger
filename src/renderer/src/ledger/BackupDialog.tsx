import { useState, type FormEvent } from 'react'
import { PASSWORD_MAX, passwordLength } from '../../../shared/password'
import { Dialog } from '../components/Dialog'
import { ErrorText } from '../components/ErrorText'

const PROBLEMS = {
  'wrong-password': 'Wrong password.',
  damaged: 'The vault could not be read.',
  unwritable: 'The file could not be saved there.',
  'unwritable-kept':
    'The file could not be saved there. The file already there was not changed.',
} as const

/** Seals a backup under the master password, then asks where to save it. */
export function BackupDialog({ onDone }: { onDone: (saved: boolean) => void }) {
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const close = () => {
    if (!working) onDone(false)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!password) return
    // No password that long was ever accepted.
    if (passwordLength(password) > PASSWORD_MAX) {
      setPassword('')
      return setProblem(PROBLEMS['wrong-password'])
    }
    setWorking(true)
    setProblem(null)
    try {
      const result = await window.ledger.backup.save(password)
      setPassword('')
      if (result.ok) return onDone(true)
      if (result.reason !== 'cancelled') setProblem(PROBLEMS[result.reason])
    } catch {
      setPassword('')
      setProblem('The backup could not be made.')
    }
    setWorking(false)
  }

  return (
    <Dialog title="Back Up Vault" onClose={close}>
      <form className="form" onSubmit={(event) => void save(event)}>
        <p className="muted">
          The backup is encrypted with your current master password. Keep it
          somewhere other than this computer.
        </p>
        <label>
          Master password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={working}
            autoFocus
          />
        </label>
        <ErrorText message={problem} />
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={working}
            onClick={close}
          >
            Cancel
          </button>
          <button type="submit" disabled={working || !password}>
            {working ? 'Backing Up…' : 'Back Up…'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
