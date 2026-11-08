// Rules give a transaction a category from its description. They run in
// order and the first that matches decides. A new rule goes in before the
// first less specific one: "is" before "starts with" before "contains", a
// longer pattern before a shorter one. The user can move rules after that.
import type { Outcome } from '../../shared/ipc'
import { PATTERN_MAX } from '../../shared/rules'
import type {
  Rule,
  RuleFields,
  RuleMatch,
  RuleReach,
  RuleSuggestion,
} from '../../shared/rules'
import type { Db } from '../vault/database'
import { isMissingReference } from './errors'
import { matchKey } from './match-key'

const RANK: Record<RuleMatch, number> = { is: 0, 'starts-with': 1, contains: 2 }

/** Negative when `a` is more specific than `b`, so it goes first. */
const specificity = (a: Pick<Rule, 'pattern' | 'match'>, b: typeof a) =>
  RANK[a.match] - RANK[b.match] ||
  matchKey(b.pattern).length - matchKey(a.pattern).length

export function matches(
  rule: Pick<Rule, 'pattern' | 'match'>,
  key: string,
): boolean {
  const pattern = matchKey(rule.pattern)
  switch (rule.match) {
    case 'is':
      return key === pattern
    case 'starts-with':
      return key.startsWith(pattern)
    case 'contains':
      return key.includes(pattern)
  }
}

/** The first rule that matches the description, if any. */
export function firstRule(
  rules: readonly Rule[],
  description: string,
): Rule | null {
  const key = matchKey(description)
  return rules.find((rule) => matches(rule, key)) ?? null
}

export function listRules(db: Db): Rule[] {
  return db
    .prepare(
      `SELECT id, pattern, match_type AS match, category_id AS categoryId
       FROM rules ORDER BY priority, id`,
    )
    .all() as Rule[]
}

function renumber(db: Db, ordered: readonly Pick<Rule, 'id'>[]): void {
  const set = db.prepare('UPDATE rules SET priority = ? WHERE id = ?')
  ordered.forEach((rule, index) => set.run(index, rule.id))
}

/**
 * Sets the category of the uncategorized transactions whose first matching
 * rule is this one; returns how many.
 */
export function applyRule(db: Db, id: number): number {
  const rules = listRules(db)
  const rule = rules.find((candidate) => candidate.id === id)
  if (!rule) return 0
  const rows = db
    .prepare(
      `SELECT id, description FROM transactions
       WHERE category_id IS NULL
         AND id NOT IN (SELECT id FROM transfer_members)`,
    )
    .all() as { id: number; description: string }[]
  const set = db.prepare(
    'UPDATE transactions SET category_id = ?, edited = 1 WHERE id = ?',
  )
  let count = 0
  for (const row of rows) {
    if (firstRule(rules, row.description)?.id !== id) continue
    count += set.run(rule.categoryId, row.id).changes
  }
  return count
}

export function createRule(
  db: Db,
  fields: RuleFields & { apply: boolean },
):
  | { ok: true; id: number; applied: number }
  | { ok: false; reason: 'not-found' } {
  try {
    return db.transaction(() => {
      const rules = listRules(db)
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO rules (pattern, match_type, category_id, priority)
           VALUES (?, ?, ?, 0)`,
        )
        .run(fields.pattern, fields.match, fields.categoryId)
      const id = Number(lastInsertRowid)
      const at = rules.findIndex((rule) => specificity(fields, rule) < 0)
      const ordered = [...rules]
      ordered.splice(at === -1 ? rules.length : at, 0, { id, ...fields })
      renumber(db, ordered)
      return {
        ok: true as const,
        id,
        applied: fields.apply ? applyRule(db, id) : 0,
      }
    })()
  } catch (error) {
    if (isMissingReference(error)) return { ok: false, reason: 'not-found' }
    throw error
  }
}

export function updateRule(
  db: Db,
  { id, ...fields }: RuleFields & { id: number },
): Outcome<'not-found'> {
  try {
    const { changes } = db
      .prepare(
        `UPDATE rules SET pattern = ?, match_type = ?, category_id = ?
         WHERE id = ?`,
      )
      .run(fields.pattern, fields.match, fields.categoryId, id)
    return changes > 0 ? { ok: true } : { ok: false, reason: 'not-found' }
  } catch (error) {
    if (isMissingReference(error)) return { ok: false, reason: 'not-found' }
    throw error
  }
}

export function deleteRule(db: Db, id: number): Outcome<'not-found'> {
  const { changes } = db.prepare('DELETE FROM rules WHERE id = ?').run(id)
  return changes > 0 ? { ok: true } : { ok: false, reason: 'not-found' }
}

/** Moves a rule one place earlier (-1) or later (1) in the list. */
export function moveRule(
  db: Db,
  id: number,
  offset: -1 | 1,
): Outcome<'not-found'> {
  return db.transaction((): Outcome<'not-found'> => {
    const rules = listRules(db)
    const from = rules.findIndex((rule) => rule.id === id)
    if (from === -1) return { ok: false, reason: 'not-found' }
    const to = from + offset
    if (to < 0 || to >= rules.length) return { ok: true }
    const [moved] = rules.splice(from, 1)
    if (moved) rules.splice(to, 0, moved)
    renumber(db, rules)
    return { ok: true }
  })()
}

/**
 * What a rule would match among the transactions, at the place it has or,
 * for a new rule, the place it would get.
 */
export function ruleReach(
  db: Db,
  rule: Pick<Rule, 'pattern' | 'match'> & { id?: number },
): RuleReach {
  const rules = listRules(db)
  const at =
    rule.id === undefined
      ? rules.findIndex((other) => specificity(rule, other) < 0)
      : rules.findIndex((other) => other.id === rule.id)
  const earlier = (at === -1 ? rules : rules.slice(0, at)).filter(
    (other) => other.id !== rule.id,
  )
  const rows = db
    .prepare(
      `SELECT description, category_id AS categoryId,
         id IN (SELECT id FROM transfer_members) AS transfer
       FROM transactions`,
    )
    .all() as {
    description: string
    categoryId: number | null
    transfer: number
  }[]
  const reach: RuleReach = { matches: 0, taken: 0, uncategorized: 0 }
  for (const row of rows) {
    const key = matchKey(row.description)
    if (!matches(rule, key)) continue
    reach.matches++
    if (earlier.some((other) => matches(other, key))) reach.taken++
    // A transfer needs no category, so applying a rule leaves it alone.
    else if (row.categoryId === null && !row.transfer) reach.uncategorized++
  }
  return reach
}

/**
 * The part of a description that names the payee, without the card number,
 * the bank's value date, or reference numbers, which vary between
 * purchases at the same place.
 */
export function payeeOf(description: string): string {
  const payee = description
    .replace(/\bvalue date:?\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/gi, ' ')
    .replace(/\bcard\s+x+\d+/gi, ' ')
    .replace(/\S*\d{3,}\S*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const chosen = payee.length >= 3 ? payee : description.trim()
  if (chosen.length <= PATTERN_MAX) return chosen
  // A rule's text has a limit; the start of a payee names it.
  const cut = chosen.slice(0, PATTERN_MAX + 1)
  const space = cut.lastIndexOf(' ')
  return (space > 0 ? cut.slice(0, space) : cut.slice(0, PATTERN_MAX)).trim()
}

/**
 * A rule to offer after the user set this transaction's category by hand:
 * only when no rule already gives it that category, another transaction
 * has the same payee, and the user has not declined this payee before.
 */
export function suggestRule(db: Db, id: number): RuleSuggestion | null {
  const transaction = db
    .prepare(
      'SELECT description, category_id AS categoryId FROM transactions WHERE id = ?',
    )
    .get(id) as { description: string; categoryId: number | null } | undefined
  if (!transaction || transaction.categoryId === null) return null
  const rules = listRules(db)
  const current = firstRule(rules, transaction.description)
  if (current?.categoryId === transaction.categoryId) return null

  const pattern = payeeOf(transaction.description)
  const declined = db
    .prepare('SELECT 1 FROM rule_dismissals WHERE key = ?')
    .get(matchKey(pattern))
  if (declined) return null
  const proposed = { pattern, match: 'contains' as const }
  const matching = (
    db.prepare('SELECT description FROM transactions').all() as {
      description: string
    }[]
  ).filter((row) => matches(proposed, matchKey(row.description))).length
  if (matching < 2) return null
  return {
    ...proposed,
    categoryId: transaction.categoryId,
    matches: matching,
    rule: current,
  }
}

/** Stops suggesting rules for this payee. */
export function declineSuggestion(db: Db, pattern: string): void {
  db.prepare('INSERT OR IGNORE INTO rule_dismissals (key) VALUES (?)').run(
    matchKey(pattern),
  )
}
