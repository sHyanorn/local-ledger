/**
 * A system error code such as EIO, or the error's class name: something to
 * log that never carries a message, which may hold a path or a query.
 */
export function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'
  const { code } = error as { code?: unknown }
  return typeof code === 'string' ? code : error.name
}
