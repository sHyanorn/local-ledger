import { useState } from 'react'
import type { FormEvent } from 'react'
import { newPasswordProblem } from '../password-rules'
import { useVault, type Reason } from '../store'
import { RestoreDialog } from './RestoreDialog'
import { ErrorText } from '../components/ErrorText'

const MESSAGES: Record<Reason<'vault:create'> | 'failed', string | null> = {
  exists: 'A vault already exists here.',
  failed: 'The vault could not be created. Try again.',
  // A lock replaces this page.
  locked: null,
}

export function Setup() {
  const create = useVault((store) => store.create)
  const busy = useVault((store) => store.busy)
  // This page only creates, so its notices are create's.
  const notice = useVault((store) => store.notice) as
    keyof typeof MESSAGES | null
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const problem = newPasswordProblem(password, confirm)
  const message = submitted && problem ? problem : notice && MESSAGES[notice]

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!problem) void create(password)
  }

  return (
    <main className="gate">
      <form className="panel" onSubmit={submit} noValidate>
        <h1>Create a master password</h1>
        <label>
          Master password
          <input
            type="password"
            autoComplete="new-password"
            placeholder="A sentence only you would know"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={busy}
          />
        </label>
        <ErrorText message={message} />
        <p className="consequence">
          If you forget this password, your data cannot be recovered.
        </p>
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create Vault'}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => setRestoring(true)}
          disabled={busy}
        >
          Restore from Backup…
        </button>
      </form>
      {restoring && (
        <RestoreDialog replacing={false} onClose={() => setRestoring(false)} />
      )}
    </main>
  )
}
