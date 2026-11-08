import { useState } from 'react'
import { DismissButton } from '../components/NoticeBar'
import type { RuleSuggestion } from '../../../shared/rules'
import { RuleDialog } from './RuleDialog'
import { categoryName, useLedger } from './store'
import { count } from './format'

/**
 * Offers a rule after the user categorized a transaction by hand. It never
 * blocks the list; dismissing it, or asking it not to come back for this
 * payee, are both one click.
 */
export function RuleSuggestionBar({
  suggestion,
  onDone,
}: {
  suggestion: RuleSuggestion
  /** Called once the suggestion is acted on or dismissed; `changed` after a rule was saved. */
  onDone: (changed: boolean) => void
}) {
  const categories = useLedger((store) => store.categories)
  const [editing, setEditing] = useState(false)
  const target = categoryName(categories, suggestion.categoryId)

  const decline = async () => {
    try {
      await window.ledger.rules.decline(suggestion.pattern)
    } finally {
      onDone(false)
    }
  }

  return (
    <div className="suggestion" role="region" aria-label="Rule suggestion">
      <p>
        {suggestion.rule
          ? `Change the rule for “${suggestion.rule.pattern}” to ${target}?`
          : `Put “${suggestion.pattern}” in ${target} from now on?`}
        <span className="muted">
          {' '}
          {count(suggestion.matches, 'transaction')} match
        </span>
      </p>
      <button type="button" onClick={() => setEditing(true)}>
        {suggestion.rule ? 'Update Rule…' : 'Create Rule…'}
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() => void decline()}
      >
        Don’t Ask Again
      </button>
      <DismissButton onClick={() => onDone(false)} />
      {editing && (
        <RuleDialog
          rule={suggestion.rule ?? undefined}
          start={
            suggestion.rule ? { categoryId: suggestion.categoryId } : suggestion
          }
          onSaved={() => onDone(true)}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
