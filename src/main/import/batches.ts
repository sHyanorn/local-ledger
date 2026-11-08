// Past imports, and undoing one: its transactions leave the ledger, edited
// or not, so the page asks first with the counts listed here.
import type { ImportBatch } from '../../shared/imports'
import type { Db } from '../vault/database'

/** Imports with transactions still in the ledger, newest first. */
export function listBatches(db: Db): ImportBatch[] {
  return db
    .prepare(
      `SELECT b.id, b.file_name AS fileName, b.imported_at AS importedAt,
         count(t.id) AS count, sum(t.edited) AS edited,
         sum(t.id IN (SELECT id FROM transfer_members)) AS paired
       FROM import_batches b JOIN transactions t ON t.import_batch_id = b.id
       GROUP BY b.id
       ORDER BY b.id DESC`,
    )
    .all() as ImportBatch[]
}

export function undoBatch(
  db: Db,
  id: number,
): { ok: true; count: number } | { ok: false; reason: 'not-found' } {
  return db.transaction(() => {
    const { changes } = db
      .prepare('DELETE FROM transactions WHERE import_batch_id = ?')
      .run(id)
    const batch = db.prepare('DELETE FROM import_batches WHERE id = ?').run(id)
    if (batch.changes === 0) return { ok: false, reason: 'not-found' } as const
    return { ok: true, count: changes } as const
  })()
}
