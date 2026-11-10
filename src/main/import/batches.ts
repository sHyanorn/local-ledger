// Past imports, and undoing one: its transactions leave the ledger, edited
// or not, except those a later import also held; the page asks first with
// the counts listed here.
import type { ImportBatch } from '../../shared/imports'
import type { Db } from '../vault/database'

/** A transaction of batch b that another import also held, and left out. */
const KEPT = `EXISTS (SELECT 1 FROM import_skips s
  WHERE s.transaction_id = t.id AND s.batch_id <> b.id)`

/** Imports with transactions still in the ledger, newest first. */
export function listBatches(db: Db): ImportBatch[] {
  return db
    .prepare(
      `SELECT id, fileName, importedAt, count(*) AS count, sum(kept) AS kept,
         sum(edited AND NOT kept) AS edited, sum(paired AND NOT kept) AS paired
       FROM (
         SELECT b.id, b.file_name AS fileName, b.imported_at AS importedAt,
           t.edited, t.id IN (SELECT id FROM transfer_members) AS paired,
           ${KEPT} AS kept
         FROM import_batches b JOIN transactions t ON t.import_batch_id = b.id
       )
       GROUP BY id
       ORDER BY id DESC`,
    )
    .all() as ImportBatch[]
}

/**
 * Deletes the import's transactions and the import. A transaction a later
 * import also held stays, and belongs from now on to the earliest of those
 * imports, so undoing that one removes it.
 */
export function undoBatch(
  db: Db,
  id: number,
):
  | { ok: true; count: number; kept: number }
  | { ok: false; reason: 'not-found' } {
  return db.transaction(() => {
    const heirs = db
      .prepare<[number, number], { id: number; heir: number }>(
        `SELECT t.id, min(s.batch_id) AS heir
         FROM transactions t JOIN import_skips s ON s.transaction_id = t.id
         WHERE t.import_batch_id = ? AND s.batch_id <> ?
         GROUP BY t.id`,
      )
      .all(id, id)
    const move = db.prepare(
      'UPDATE transactions SET import_batch_id = ? WHERE id = ?',
    )
    const settle = db.prepare(
      'DELETE FROM import_skips WHERE batch_id = ? AND transaction_id = ?',
    )
    for (const { id: transaction, heir } of heirs) {
      move.run(heir, transaction)
      settle.run(heir, transaction)
    }
    const { changes } = db
      .prepare('DELETE FROM transactions WHERE import_batch_id = ?')
      .run(id)
    const batch = db.prepare('DELETE FROM import_batches WHERE id = ?').run(id)
    if (batch.changes === 0) return { ok: false, reason: 'not-found' } as const
    return { ok: true, count: changes, kept: heirs.length } as const
  })()
}
