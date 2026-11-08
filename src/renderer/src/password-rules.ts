import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordLength,
} from '../../shared/password'

/** What is wrong with a new password and its confirmation, if anything. */
export function newPasswordProblem(
  password: string,
  confirm: string,
): string | null {
  const length = passwordLength(password)
  if (length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`
  if (confirm !== password) return 'The passwords do not match.'
  return null
}
