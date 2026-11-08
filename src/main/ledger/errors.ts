const code = (error: unknown) => (error as { code?: unknown }).code

/** A UNIQUE constraint failed, such as a name already taken. */
export const isDuplicate = (error: unknown) =>
  code(error) === 'SQLITE_CONSTRAINT_UNIQUE'

/** A FOREIGN KEY constraint failed: the record referred to is gone. */
export const isMissingReference = (error: unknown) =>
  code(error) === 'SQLITE_CONSTRAINT_FOREIGNKEY'
