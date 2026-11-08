import { useEffect, useState } from 'react'
import type { Rule } from '../../../shared/rules'
import { RuleDialog } from './RuleDialog'
import { MATCH_NAMES } from './rule-names'
import { categoryName, useLedger } from './store'

type Editing = { rule?: Rule } | null

/** The rules in the order they run; the first that matches decides. */
export function RulesSection() {
  const categories = useLedger((store) => store.categories)
  const [rules, setRules] = useState<Rule[]>([])
  const [editing, setEditing] = useState<Editing>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let current = true
    window.ledger.rules.list().then(
      (list) => current && setRules(list),
      () => current && setRules([]),
    )
    return () => {
      current = false
    }
  }, [generation, categories])

  const reload = () => setGeneration(generation + 1)
  const move = async (rule: Rule, offset: -1 | 1) => {
    try {
      await window.ledger.rules.move(rule.id, offset)
    } finally {
      reload()
    }
  }

  return (
    <section aria-labelledby="rules-heading">
      <div className="section-heading">
        <h2 id="rules-heading">Rules</h2>
        <button
          type="button"
          className="secondary"
          disabled={categories.length === 0}
          onClick={() => setEditing({})}
        >
          Add Rule…
        </button>
      </div>
      {rules.length > 0 && (
        <ol className="list">
          {rules.map((rule, index) => (
            <li key={rule.id} className="list-row rule">
              <button
                type="button"
                className="list-item"
                onClick={() => setEditing({ rule })}
              >
                <span className="name">
                  {MATCH_NAMES[rule.match]} “{rule.pattern}”
                </span>
                <span className="muted">
                  {categoryName(categories, rule.categoryId)}
                </span>
              </button>
              <button
                type="button"
                className="icon"
                aria-label={`Move “${rule.pattern}” Up`}
                title="Move Up"
                disabled={index === 0}
                onClick={() => void move(rule, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon"
                aria-label={`Move “${rule.pattern}” Down`}
                title="Move Down"
                disabled={index === rules.length - 1}
                onClick={() => void move(rule, 1)}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
      )}
      {editing && (
        <RuleDialog
          {...editing}
          onSaved={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
