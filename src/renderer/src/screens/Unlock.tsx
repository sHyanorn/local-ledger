import { useState } from 'react'
import type { FormEvent } from 'react'
import { useVault } from '../store'
import { ErrorText } from '../components/ErrorText'
import { RestoreDialog } from './RestoreDialog'

const MESSAGES: Record<string, string> = {
  'wrong-password': 'Wrong password.',
  newer: 'This vault needs a newer version of Local Ledger.',
  failed: 'The vault could not be opened. Try again.',
}

export function Unlock() {
  const unlock = useVault((store) => store.unlock)
  const busy = useVault((store) => store.busy)
  const notice = useVault((store) => store.notice)
  const [password, setPassword] = useState('')
  const [restoring, setRestoring] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (password) void unlock(password)
  }

  return (
    <main className="gate">
      <form className="panel" onSubmit={submit}>
        <h1>Local Ledger</h1>
        <label>
          Master password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <ErrorText message={notice ? MESSAGES[notice] : null} />
        <button type="submit" disabled={busy || !password}>
          {busy ? 'Unlocking…' : 'Unlock'}
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
        <RestoreDialog
          replacing={false}
          locked
          onClose={() => setRestoring(false)}
        />
      )}
    </main>
  )
}
