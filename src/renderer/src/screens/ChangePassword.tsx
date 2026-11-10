import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { PASSWORD_MAX, passwordLength } from '../../../shared/password'
import { newPasswordProblem } from '../password-rules'
import { ErrorText } from '../components/ErrorText'

export function ChangePassword({ onCancel }: { onCancel: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const currentField = useRef<HTMLInputElement>(null)

  const problem = newPasswordProblem(next, confirm)

  // The page stays to report a failure, without the passwords on screen.
  const fail = (message: string) => {
    setRefused(message)
    setCurrent('')
    setNext('')
    setConfirm('')
    setSubmitted(false)
  }
  useEffect(() => {
    if (refused) currentField.current?.focus()
  }, [refused])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    // A refusal of the last attempt says nothing about this one.
    setRefused(null)
    if (problem || !current) return
    // No password that long was ever accepted.
    if (passwordLength(current) > PASSWORD_MAX) return fail('Wrong password.')
    setBusy(true)
    try {
      // On success the main process replaces this page.
      const result = await window.ledger.vault.changePassword(current, next)
      if (result.ok) return
      fail(
        result.reason === 'wrong-password'
          ? 'Wrong password.'
          : 'The password could not be changed.',
      )
    } catch {
      fail('The password could not be changed.')
    } finally {
      setBusy(false)
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
            ref={currentField}
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
        <ErrorText message={message} />
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
