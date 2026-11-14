// A file being imported. It waits here, in the main process, between being
// chosen and being imported; the page sees only what it needs to decide. It
// is dropped when imported, when another file is chosen, and whenever the
// vault locks or unlocks.
import { randomUUID } from 'node:crypto'
import type { ImportRequest } from '../../shared/api'
import {
  SAMPLE_ROWS,
  type FileProblem,
  type ImportFile,
  type ImportPreview,
  type Mapping,
  type PreviewRow,
} from '../../shared/imports'
import { mapping as mappingSchema } from '../../shared/schemas'
import { firstRule, listRules } from '../ledger/rules'
import { pairTransfers } from '../ledger/transfers'
import type { Db } from '../vault/database'
import { FileError, joinOverflow, readTable, type Table } from './csv'
import { classify, type IncomingRow } from './dedup'
import { cleanText } from '../clean-text'
import { applyMapping } from './mapping'
import { detectLayout, type Layout } from './templates'

type Failure<Reason> = { ok: false; reason: Reason }

interface Pending {
  id: string
  fileName: string
  bytes: Uint8Array
  table: Table
  layout: Layout | null
  /** The request last previewed: rows are chosen by index within it. */
  previewed: string | null
}

/** The settings that decide which row has which index, and its status. */
const requestKey = (request: ImportRequest) =>
  JSON.stringify([
    request.encoding,
    mappingSchema.parse(request.mapping),
    request.targets.map((target) => [target.key, target.accountId]),
  ])

/** The first row as a key for the columns the user chose for its file. */
const signatureOf = (table: Table) =>
  (table.rows[0]?.cells ?? [])
    .map((cell) => cleanText(cell).toLowerCase())
    .join('\u001f')

function rememberedMapping(db: Db, table: Table): Mapping | null {
  const row = db
    .prepare<[string], { mapping: string }>(
      'SELECT mapping FROM import_mappings WHERE signature = ?',
    )
    .get(signatureOf(table))
  if (!row) return null
  try {
    const parsed = mappingSchema.safeParse(JSON.parse(row.mapping))
    return parsed.success && parsed.data.header ? parsed.data : null
  } catch {
    return null
  }
}

const sameMapping = (a: Mapping, b: Mapping) =>
  JSON.stringify(mappingSchema.parse(a)) ===
  JSON.stringify(mappingSchema.parse(b))

/**
 * Remembers columns the user changed for a file with a header, so the next
 * file with that header opens with them; choosing the detected ones forgets.
 */
function rememberMapping(db: Db, pending: Pending, mapping: Mapping): void {
  if (!mapping.header) return
  const signature = signatureOf(pending.table)
  if (pending.layout && sameMapping(mapping, pending.layout.mapping)) {
    db.prepare('DELETE FROM import_mappings WHERE signature = ?').run(signature)
    return
  }
  db.prepare(
    `INSERT INTO import_mappings (signature, mapping) VALUES (?, ?)
     ON CONFLICT (signature) DO UPDATE SET mapping = excluded.mapping`,
  ).run(signature, JSON.stringify(mapping))
}

function problemOf(error: unknown): FileProblem {
  if (error instanceof FileError) return error.code
  throw error
}

export class ImportSession {
  #pending: Pending | null = null

  /** Reads the file and keeps it waiting; a file chosen earlier is dropped. */
  open(
    db: Db,
    fileName: string,
    bytes: Uint8Array,
  ): { ok: true; file: ImportFile } | Failure<FileProblem> {
    this.clear()
    let table: Table
    try {
      table = readTable(bytes)
    } catch (error) {
      bytes.fill(0)
      return { ok: false, reason: problemOf(error) }
    }
    const layout = detectLayout(table.rows)
    const id = randomUUID()
    this.#pending = { id, fileName, bytes, table, layout, previewed: null }
    const mapping = rememberedMapping(db, table) ?? layout?.mapping ?? null
    return {
      ok: true,
      file: {
        id,
        fileName,
        encoding: table.encoding,
        template: layout?.template ?? null,
        mapping,
        dateOrders: layout?.dateOrders ?? [],
        columns: Math.max(...table.rows.map((row) => row.cells.length)),
        sample: table.rows.slice(0, SAMPLE_ROWS).map((row) => row.cells),
        groups: this.#groups(table, layout),
      },
    }
  }

  #groups(table: Table, layout: Layout | null): ImportFile['groups'] {
    if (layout?.accountColumn == null) return null
    const counts = new Map<string, number>()
    const rows = layout.mapping.header ? table.rows.slice(1) : table.rows
    for (const row of rows) {
      const key = cleanText(row.cells[layout.accountColumn] ?? '')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts].map(([key, count]) => ({ key, rows: count }))
  }

  /** The rows as the request would import them, or why it cannot. */
  preview(
    db: Db,
    request: ImportRequest,
  ): { ok: true; preview: ImportPreview } | Failure<FileProblem | 'not-found'> {
    const built = this.#build(db, request)
    if (!built.ok) return built
    built.pending.previewed = requestKey(request)
    return { ok: true, preview: built.preview }
  }

  #build(
    db: Db,
    request: ImportRequest,
  ):
    | { ok: true; pending: Pending; preview: ImportPreview; prints: string[] }
    | Failure<FileProblem | 'not-found'> {
    const pending = this.#pending
    if (!pending || pending.id !== request.id) {
      return { ok: false, reason: 'not-found' }
    }
    if (request.encoding !== pending.table.encoding) {
      try {
        pending.table = readTable(pending.bytes, request.encoding)
      } catch (error) {
        return { ok: false, reason: problemOf(error) }
      }
    }
    const targets = new Map(
      request.targets.map((target) => [target.key, target.accountId]),
    )
    const accountIds = [...new Set(targets.values())].filter(
      (id) => id !== null,
    )
    const known = db
      .prepare<number[], { id: number }>(
        `SELECT id FROM accounts WHERE id IN (${accountIds.map(() => '?').join(',') || 'NULL'})`,
      )
      .all(...accountIds)
    if (known.length !== accountIds.length) {
      return { ok: false, reason: 'not-found' }
    }

    const table = joinOverflow(
      pending.table.rows,
      pending.table.delimiter,
      request.mapping.description[0],
    )
    const column = pending.layout?.accountColumn ?? null
    const cellsByLine = new Map(table.map((row) => [row.line, row.cells]))
    const accountOf = (line: number) => {
      const key =
        column === null ? '' : cleanText(cellsByLine.get(line)?.[column] ?? '')
      return targets.get(key) ?? null
    }

    const { rows, errors } = applyMapping(
      table,
      request.mapping,
      pending.table.delimiter,
    )
    const incoming: (IncomingRow & { line: number })[] = []
    rows.forEach((row, index) => {
      const accountId = accountOf(row.line)
      if (accountId === null) return
      incoming.push({
        index,
        line: row.line,
        accountId,
        date: row.date,
        cents: row.cents,
        description: row.description,
      })
    })
    const classified = classify(db, incoming)
    const rules = listRules(db)
    return {
      ok: true,
      pending,
      prints: classified.map((entry) => entry.fingerprint),
      preview: {
        rows: incoming.map((row, position): PreviewRow => ({
          index: row.index,
          line: row.line,
          accountId: row.accountId,
          date: row.date,
          amountCents: row.cents,
          description: row.description,
          status: classified[position]?.status ?? 'new',
          match: classified[position]?.match ?? null,
          categoryId: firstRule(rules, row.description)?.categoryId ?? null,
        })),
        errors: errors.filter((error) => accountOf(error.line) !== null),
      },
    }
  }

  /**
   * Imports the selected rows in one transaction, never one already in the
   * ledger, and remembers columns the user changed for files with this header.
   */
  commit(
    db: Db,
    request: ImportRequest & { selected: number[] },
  ):
    | { ok: true; id: number; count: number; paired: number }
    | Failure<FileProblem | 'not-found' | 'nothing' | 'changed'> {
    // The indexes name rows of the preview the user saw; settings changed
    // since would give them to other rows.
    const waiting = this.#pending
    if (
      waiting?.id === request.id &&
      waiting.previewed !== requestKey(request)
    ) {
      return { ok: false, reason: 'changed' }
    }
    const built = this.#build(db, request)
    if (!built.ok) return built
    const { pending, preview, prints } = built
    const selected = new Set(request.selected)
    const chosen = preview.rows.flatMap((row, position) =>
      selected.has(row.index) && row.status !== 'duplicate'
        ? [{ row, fingerprint: prints[position] ?? null }]
        : [],
    )
    if (chosen.length === 0) return { ok: false, reason: 'nothing' }

    const imported = db.transaction(() => {
      const batchId = Number(
        db
          .prepare(
            'INSERT INTO import_batches (file_name, row_count) VALUES (?, 0)',
          )
          .run(pending.fileName).lastInsertRowid,
      )
      const insert = db.prepare(
        `INSERT OR IGNORE INTO transactions
           (account_id, date, amount_cents, description, category_id,
            import_batch_id, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      let count = 0
      for (const { row, fingerprint } of chosen) {
        count += insert.run(
          row.accountId,
          row.date,
          row.amountCents,
          row.description,
          row.categoryId,
          batchId,
          fingerprint,
        ).changes
      }
      db.prepare('UPDATE import_batches SET row_count = ? WHERE id = ?').run(
        count,
        batchId,
      )
      // Rows left out because an earlier import already brought them in:
      // undoing that import keeps them, for this one (D042).
      const skipExact = db.prepare(
        `INSERT OR IGNORE INTO import_skips (batch_id, transaction_id)
         SELECT ?, id FROM transactions
         WHERE account_id = ? AND hash = ? AND import_batch_id IS NOT NULL`,
      )
      const skipMatch = db.prepare(
        `INSERT OR IGNORE INTO import_skips (batch_id, transaction_id)
         SELECT ?, id FROM transactions
         WHERE id = ? AND import_batch_id IS NOT NULL`,
      )
      preview.rows.forEach((row, position) => {
        if (row.status === 'duplicate')
          skipExact.run(batchId, row.accountId, prints[position])
        else if (row.match && !selected.has(row.index))
          skipMatch.run(batchId, row.match.id)
      })
      rememberMapping(db, pending, request.mapping)
      const paired = pairTransfers(db, batchId)
      // A transfer needs no category; one a rule gave on import goes.
      db.prepare(
        `UPDATE transactions SET category_id = NULL
         WHERE import_batch_id = ? AND id IN (SELECT id FROM transfer_members)`,
      ).run(batchId)
      return { id: batchId, count, paired }
    })()
    this.clear()
    return { ok: true, ...imported }
  }

  discard(id: string): void {
    if (this.#pending?.id === id) this.clear()
  }

  /** Drops the waiting file and zeroes its bytes; its parsed text stays until collected. */
  clear(): void {
    this.#pending?.bytes.fill(0)
    this.#pending = null
  }
}
