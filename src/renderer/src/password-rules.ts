import { PASSWORD_MIN, passwordLength } from '../../shared/password'

/** What is wrong with a new password and its confirmation, if anything. */
export function newPasswordProblem(
  password: string,
  confirm: string,
): string | null {
  if (passwordLength(password) < PASSWORD_MIN) {
    return `Use at least ${PASSWORD_MIN} characters.`
  }
  if (confirm !== password) return 'The passwords do not match.'
  return null
}
