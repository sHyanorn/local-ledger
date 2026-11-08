import { useEffect, useState, type FormEvent } from 'react'
import {
  PATTERN_MAX,
  RULE_MATCHES,
  type Rule,
  type RuleMatch,
  type RuleReach,
} from '../../../shared/rules'
import { Dialog } from '../components/Dialog'
import { CategoryOptions } from './CategoryOptions'
import { MATCH_NAMES } from './rule-names'
import { count, useLedger } from './store'

/**
 * Adds a rule, or with `rule`, edits or deletes it. `start` fills a new
 * rule, or a change to `rule`, from a suggestion.
 */
export function RuleDialog({
  rule,
  start,
  onSaved,
  onClose,
}: {
  rule?: Rule
  start?: Partial<Omit<Rule, 'id'>>
  onSaved: () => void
  onClose: () => void
}) {
  const categories = useLedger((store) => store.categories)
  const refresh = useLedger((store) => store.refresh)
  const [match, setMatch] = useState<RuleMatch>(
    start?.match ?? rule?.match ?? 'contains',
  )
  const [pattern, setPattern] = useState(start?.pattern ?? rule?.pattern ?? '')
  const [categoryId, setCategoryId] = useState(
    start?.categoryId ?? rule?.categoryId ?? categories[0]?.id ?? 0,
  )
  const [reach, setReach] = useState<RuleReach | null>(null)
  const [apply, setApply] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // How far the rule reaches, once typing pauses.
  useEffect(() => {
    if (!pattern.trim()) return
    let current = true
    const timer = setTimeout(() => {
      window.ledger.rules
        .reach({ pattern, match, ...(rule ? { id: rule.id } : {}) })
        .then(
          (answer) => current && setReach(answer),
          () => current && setReach(null),
        )
    }, 200)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [pattern, match, rule])

  const shown = pattern.trim() ? reach : null

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!pattern.trim()) return setProblem('Enter the text to match.')
    setBusy(true)
    try {
      const fields = { pattern, match, categoryId }
      const result = rule
        ? await window.ledger.rules.update({ id: rule.id, ...fields })
        : await window.ledger.rules.create({
            ...fields,
            apply: apply && (shown?.uncategorized ?? 0) > 0,
          })
      if (!result.ok) return setProblem('The category no longer exists.')
      await refresh()
      onSaved()
      onClose()
    } catch {
      setProblem('The rule could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!rule) return
    try {
      await window.ledger.rules.delete(rule.id)
      await refresh()
      onSaved()
      onClose()
    } catch {
      setProblem('The rule could not be deleted.')
    }
  }

  return (
    <Dialog title={rule ? 'Edit Rule' : 'New Rule'} onClose={onClose}>
      <form className="form" onSubmit={save} noValidate>
        <div className="row">
          <label>
            Description
            <select
              value={match}
              onChange={(event) => setMatch(event.target.value as RuleMatch)}
            >
              {RULE_MATCHES.map((option) => (
                <option key={option} value={option}>
                  {MATCH_NAMES[option]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Text
            <input
              value={pattern}
              maxLength={PATTERN_MAX}
              onChange={(event) => setPattern(event.target.value)}
              autoFocus
            />
          </label>
        </div>
        <label>
          Category
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(Number(event.target.value))}
          >
            <CategoryOptions />
          </select>
        </label>
        {shown && (
          <p className="muted" aria-live="polite">
            Matches {count(shown.matches, 'transaction')}
            {shown.taken > 0 &&
              `; ${shown.taken.toLocaleString('en-AU')} go to an earlier rule`}
          </p>
        )}
        {!rule && shown && shown.uncategorized > 0 && (
          <label className="check">
            <input
              type="checkbox"
              checked={apply}
              onChange={(event) => setApply(event.target.checked)}
            />
            Categorize {count(shown.uncategorized, 'uncategorized transaction')}
          </label>
        )}
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <div className="actions">
          {rule && (
            <button
              type="button"
              className="secondary destructive"
              onClick={() => void remove()}
            >
              Delete Rule
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || categories.length === 0}>
            {rule ? 'Save' : 'Add Rule'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
