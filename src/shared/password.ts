/** Master password length, in code points after NFKC normalization. */
export const PASSWORD_MIN = 15
export const PASSWORD_MAX = 1024

export function passwordLength(password: string): number {
  return [...password.normalize('NFKC')].length
}
