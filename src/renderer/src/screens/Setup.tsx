import { useState } from 'react'
import type { FormEvent } from 'react'
import { PASSWORD_MIN, passwordLength } from '../../../shared/password'
import { useVault } from '../store'

export function Setup() {
  const create = useVault((store) => store.create)
  const busy = useVault((store) => store.busy)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const problem =
    passwordLength(password) < PASSWORD_MIN
      ? `Use at least ${PASSWORD_MIN} characters.`
      : confirm !== password
        ? 'The passwords do not match.'
        : null

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
        {submitted && problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <p className="consequence">
          If you forget this password, your data cannot be recovered.
        </p>
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create Vault'}
        </button>
      </form>
    </main>
  )
}
