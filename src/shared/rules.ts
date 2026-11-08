// Categorization rules as the page sees them. Free of zod, like ledger.ts.
export type { RuleFields } from './schemas'

/** How a rule's pattern meets a description; case and spacing never count. */
export const RULE_MATCHES = ['contains', 'starts-with', 'is'] as const
export type RuleMatch = (typeof RULE_MATCHES)[number]

export const PATTERN_MAX = 100

export interface Rule {
  id: number
  pattern: string
  match: RuleMatch
  categoryId: number
}

/** What a rule would do to the transactions already in the ledger. */
export interface RuleReach {
  /** Transactions whose description it matches. */
  matches: number
  /** Of those, how many a rule earlier in the list matches first. */
  taken: number
  /** Of the rest, how many are uncategorized, which applying it would set. */
  uncategorized: number
}

/** A rule offered after the user gave a transaction a category by hand. */
export interface RuleSuggestion {
  pattern: string
  match: RuleMatch
  categoryId: number
  /** Transactions the pattern matches, the changed one included. */
  matches: number
  /** The rule that puts these transactions elsewhere, to update instead. */
  rule: Rule | null
}
