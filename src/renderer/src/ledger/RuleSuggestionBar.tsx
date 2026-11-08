import { useState } from 'react'
import type { RuleSuggestion } from '../../../shared/rules'
import { RuleDialog } from './RuleDialog'
import { categoryName, count, useLedger } from './store'

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
      <button
        type="button"
        className="icon"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => onDone(false)}
      >
        ×
      </button>
      {editing &&
        (suggestion.rule ? (
          <RuleDialog
            rule={suggestion.rule}
            start={{ categoryId: suggestion.categoryId }}
            onSaved={() => onDone(true)}
            onClose={() => setEditing(false)}
          />
        ) : (
          <RuleDialog
            start={suggestion}
            onSaved={() => onDone(true)}
            onClose={() => setEditing(false)}
          />
        ))}
    </div>
  )
}
