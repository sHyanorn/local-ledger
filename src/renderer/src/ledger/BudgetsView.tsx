import { useEffect, useState, type FormEvent } from 'react'
import {
  budgetState,
  HOME_CURRENCY,
  type CategoryBudget,
  type MonthBudgets,
} from '../../../shared/budgets'
import type { Category } from '../../../shared/ledger'
import {
  centsToDecimal,
  formatAmount,
  parseAmount,
} from '../../../shared/money'
import { formatMonth, monthOf, shiftMonth } from './format'
import { categoryTree, useLedger } from './store'

const money = (cents: number) => formatAmount(cents, HOME_CURRENCY)

/** Each category's spending this month against its budget, which the user sets here. */
export function BudgetsView() {
  const categories = useLedger((store) => store.categories)
  const refresh = useLedger((store) => store.refresh)
  const [month, setMonth] = useState(monthOf)
  const [budgets, setBudgets] = useState<MonthBudgets | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let current = true
    window.ledger.budgets.month(month).then(
      (answer) => current && setBudgets(answer),
      () => current && setBudgets(null),
    )
    return () => {
      current = false
    }
  }, [month, generation, categories])

  const saved = () => {
    setGeneration(generation + 1)
    void refresh()
  }
  const byId = new Map(budgets?.categories.map((b) => [b.categoryId, b]))
  const row = (category: Category, child = false) => {
    const budget = byId.get(category.id)
    return budget ? (
      <BudgetRow
        key={`${category.id}:${month}`}
        category={category}
        budget={budget}
        month={month}
        child={child}
        onSaved={saved}
      />
    ) : null
  }

  return (
    <div className="content">
      <header className="toolbar">
        <h1>Budgets</h1>
        <div className="actions month-switch">
          <button
            type="button"
            className="icon"
            aria-label="Previous Month"
            title="Previous Month"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            ‹
          </button>
          <span aria-live="polite">{formatMonth(month)}</span>
          <button
            type="button"
            className="icon"
            aria-label="Next Month"
            title="Next Month"
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            ›
          </button>
        </div>
      </header>
      <div className="scroll">
        {budgets && (
          <div className="budgets">
            <ul
              className="list"
              aria-label={`Budgets for ${formatMonth(month)}`}
            >
              {categoryTree(categories).flatMap(({ category, children }) => [
                row(category),
                ...children.map((child) => row(child, true)),
              ])}
            </ul>
            <p className="muted budget-extra">
              Uncategorized {money(budgets.uncategorizedCents)}
              {budgets.otherCurrencies.map(
                (other) =>
                  ` · ${formatAmount(other.spentCents, other.currency)} in ${other.currency}, not counted`,
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function BudgetRow({
  category,
  budget,
  month,
  child,
  onSaved,
}: {
  category: Category
  budget: CategoryBudget
  month: string
  child: boolean
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [problem, setProblem] = useState('')
  const state = budgetState(budget)
  const share =
    budget.budgetCents === null
      ? 0
      : budget.budgetCents === 0
        ? 1
        : Math.min(1, budget.spentCents / budget.budgetCents)

  const start = () => {
    setText(
      budget.budgetCents === null ? '' : centsToDecimal(budget.budgetCents),
    )
    setProblem('')
    setEditing(true)
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const cents = text.trim() === '' ? null : parseAmount(text)
    if (cents !== null && cents < 0)
      return setProblem('Enter an amount without a sign.')
    if (text.trim() !== '' && cents === null)
      return setProblem('Enter an amount, such as 600.')
    try {
      const result = await window.ledger.budgets.set(category.id, month, cents)
      if (!result.ok) return setProblem('The category no longer exists.')
      setEditing(false)
      onSaved()
    } catch {
      setProblem('The budget could not be saved.')
    }
  }

  const label =
    budget.budgetCents === null
      ? `${money(budget.spentCents)} spent`
      : state === 'over'
        ? `${money(budget.spentCents - budget.budgetCents)} over ${money(budget.budgetCents)}`
        : `${money(budget.spentCents)} of ${money(budget.budgetCents)}`

  return (
    <li className={`budget ${state}${child ? ' child' : ''}`}>
      <span className="name">{category.name}</span>
      {budget.budgetCents === null ? (
        <span />
      ) : (
        <svg className="bar" aria-hidden="true" width="100%" height="6">
          <rect className="track" width="100%" height="6" rx="3" />
          <rect className="fill" width={`${share * 100}%`} height="6" rx="3" />
        </svg>
      )}
      {editing ? (
        <form className="budget-form" onSubmit={save} noValidate>
          <input
            aria-label={`Budget for ${category.name} from ${formatMonth(month)}`}
            inputMode="decimal"
            placeholder="No budget"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(false)
            }}
            autoFocus
          />
          <button type="submit">Save</button>
          {problem && (
            <span className="error" role="alert">
              {problem}
            </span>
          )}
        </form>
      ) : (
        <>
          <span className="figure">{label}</span>
          <button
            type="button"
            className="secondary"
            aria-label={`${budget.budgetCents === null ? 'Set' : 'Change'} budget for ${category.name}`}
            onClick={start}
          >
            {budget.budgetCents === null ? 'Set…' : 'Change…'}
          </button>
        </>
      )}
    </li>
  )
}
