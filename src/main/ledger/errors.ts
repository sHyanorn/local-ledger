import type { Outcome } from '../../shared/ipc'

const code = (error: unknown) => (error as { code?: unknown }).code

type Refused<Reason> = { ok: false; reason: Reason }

/** Runs a write; a UNIQUE constraint that fails, such as a name already taken, is `duplicate`. */
export function orDuplicate<T>(write: () => T): T | Refused<'duplicate'> {
  try {
    return write()
  } catch (error) {
    if (code(error) === 'SQLITE_CONSTRAINT_UNIQUE')
      return { ok: false, reason: 'duplicate' }
    throw error
  }
}

/** Runs a write; a FOREIGN KEY constraint that fails, a record referred to that is gone, is `not-found`. */
export function orNotFound<T>(write: () => T): T | Refused<'not-found'> {
  try {
    return write()
  } catch (error) {
    if (code(error) === 'SQLITE_CONSTRAINT_FOREIGNKEY')
      return { ok: false, reason: 'not-found' }
    throw error
  }
}

/** The outcome of a write by id: no row changed means no such record. */
export const found = (changes: number): Outcome<'not-found'> =>
  changes > 0 ? { ok: true } : { ok: false, reason: 'not-found' }
