// Which incoming rows the ledger already holds. Nothing here changes or
// removes a transaction: it only decides which rows are new.
//
// A row's fingerprint is its account, date, amount and description, plus its
// occurrence among identical rows of the file (YNAB's import_id). Two genuine
// purchases alike in every way are occurrences 1 and 2, so both import; a later
// file that overlaps gives them the same fingerprints, so neither repeats.
//
// A row without an exact match may still be a transaction entered by hand,
// or one the bank has since reworded: the same amount in the same account
// within a few days. Each existing transaction answers for one row at most,
// so two alike rows against one transaction leave one of them new.
import { createHash } from 'node:crypto'
import type { ExistingMatch, RowStatus } from '../../shared/imports'
import { matchKey } from '../ledger/match-key'
import type { Db } from '../vault/database'

/** Days apart that a reworded or hand-entered transaction may be. */
export const MATCH_DAYS = 4
/** Existing transactions considered for each incoming row, nearest first. */
const NEAREST = 10

export interface IncomingRow {
  index: number
  accountId: number
  date: string
  cents: number
  description: string
}

export interface Classified {
  fingerprint: string
  status: RowStatus
  match: ExistingMatch | null
}

/** Fingerprints in file order; identical rows are counted, not merged. */
export function fingerprints(rows: readonly IncomingRow[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const key = [
      row.accountId,
      row.date,
      row.cents,
      matchKey(row.description),
    ].join('\u001f')
    const occurrence = (seen.get(key) ?? 0) + 1
    seen.set(key, occurrence)
    return createHash('sha256')
      .update(
        `${row.date}\u001f${row.cents}\u001f${matchKey(row.description)}\u001f${occurrence}`,
      )
      .digest('hex')
  })
}

const DAY = 86_400_000
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY
const shiftDate = (date: string, days: number) =>
  new Date((dayNumber(date) + days) * DAY).toISOString().slice(0, 10)

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1),
  )

/** Words two descriptions share, of all their words: 0 to 1. */
export function similarity(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  if (left.size === 0 && right.size === 0) return 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared++
  return shared / (left.size + right.size - shared)
}

export function classify(db: Db, rows: readonly IncomingRow[]): Classified[] {
  const prints = fingerprints(rows)
  const wordSets = new Map<string, Set<string>>()
  const wordsOf = (text: string) => {
    let set = wordSets.get(text)
    if (!set) wordSets.set(text, (set = words(text)))
    return set
  }
  const exact = db.prepare<[number, string], { id: number }>(
    'SELECT id FROM transactions WHERE account_id = ? AND hash = ?',
  )
  // Transactions an exact fingerprint already accounts for.
  const taken = new Set<number>()
  const result: Classified[] = rows.map((row, position) => {
    const fingerprint = prints[position] ?? ''
    const found = exact.get(row.accountId, fingerprint)
    if (found) taken.add(found.id)
    return { fingerprint, status: found ? 'duplicate' : 'new', match: null }
  })

  const near = db.prepare<
    [number, number, string, string, string],
    { id: number; date: string; amountCents: number; description: string }
  >(
    `SELECT id, date, amount_cents AS amountCents, description
     FROM transactions
     WHERE account_id = ? AND amount_cents = ? AND date BETWEEN ? AND ?
     ORDER BY abs(julianday(date) - julianday(?)), id
     LIMIT ${NEAREST}`,
  )
  // Many alike rows on alike days would otherwise compare every one with
  // every other; a few nearest candidates each are enough to choose from.
  const pairs: {
    position: number
    match: ExistingMatch
    days: number
    alike: number
  }[] = []
  rows.forEach((row, position) => {
    if (result[position]?.status !== 'new') return
    for (const match of near.all(
      row.accountId,
      row.cents,
      shiftDate(row.date, -MATCH_DAYS),
      shiftDate(row.date, MATCH_DAYS),
      row.date,
    )) {
      if (taken.has(match.id)) continue
      pairs.push({
        position,
        match,
        days: Math.abs(dayNumber(match.date) - dayNumber(row.date)),
        alike: similarity(wordsOf(match.description), wordsOf(row.description)),
      })
    }
  })
  // Closest dates first, then the most alike, then file order: stable and greedy.
  pairs.sort(
    (a, b) => a.days - b.days || b.alike - a.alike || a.position - b.position,
  )
  for (const pair of pairs) {
    const entry = result[pair.position]
    if (!entry || entry.match || taken.has(pair.match.id)) continue
    taken.add(pair.match.id)
    entry.status = 'possible'
    entry.match = pair.match
  }
  return result
}
