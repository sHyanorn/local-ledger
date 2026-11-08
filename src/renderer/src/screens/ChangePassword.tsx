import { useState } from 'react'
import type { FormEvent } from 'react'
import { newPasswordProblem } from '../password-rules'

export function ChangePassword({ onCancel }: { onCancel: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  const problem = newPasswordProblem(next, confirm)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (problem || !current) return
    setBusy(true)
    setRefused(null)
    // On success the main process replaces this page.
    const result = await window.ledger.vault.changePassword(current, next)
    setBusy(false)
    if (!result.ok) {
      setRefused(
        result.reason === 'wrong-password'
          ? 'Wrong password.'
          : 'The password could not be changed.',
      )
    }
  }

  const message = refused ?? (submitted ? problem : null)

  return (
    <main className="gate">
      <form className="panel" onSubmit={submit} noValidate>
        <h1>Change master password</h1>
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            placeholder="A sentence only you would know"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={busy}
          />
        </label>
        {message && (
          <p className="error" role="alert">
            {message}
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? 'Changing…' : 'Change Password'}
          </button>
        </div>
      </form>
    </main>
  )
}
