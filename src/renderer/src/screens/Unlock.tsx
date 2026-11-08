import { useState } from 'react'
import type { FormEvent } from 'react'
import { useVault } from '../store'

const MESSAGES: Record<string, string> = {
  'wrong-password': 'Wrong password.',
  newer: 'This vault needs a newer version of Local Ledger.',
}

export function Unlock() {
  const unlock = useVault((store) => store.unlock)
  const busy = useVault((store) => store.busy)
  const notice = useVault((store) => store.notice)
  const [password, setPassword] = useState('')

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
        {notice && MESSAGES[notice] && (
          <p className="error" role="alert">
            {MESSAGES[notice]}
          </p>
        )}
        <button type="submit" disabled={busy || !password}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </main>
  )
}
