// Importing as the page does, for unit tests of the import session.
import type { ImportSession } from '../../src/main/import/session'
import type { Db } from '../../src/main/vault/database'

/** Commits after previewing the same request, as the page does. */
export function previewAndCommit(
  db: Db,
  session: ImportSession,
  request: Parameters<ImportSession['commit']>[1],
) {
  const { selected: _selected, ...shown } = request
  session.preview(db, shown)
  return session.commit(db, request)
}
