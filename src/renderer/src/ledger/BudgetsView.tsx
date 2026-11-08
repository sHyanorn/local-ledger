import { useEffect, useState, type FormEvent } from 'react'
import {
  budgetState,
  type CategoryBudget,
  type MonthBudgets,
} from '../../../shared/budgets'
import type { Category } from '../../../shared/ledger'
import {
  centsToDecimal,
  formatAmount,
  parseAmount,
  type Currency,
} from '../../../shared/money'
import { formatMonth, monthOf } from './format'
import { MonthStepper } from './MonthStepper'
import { BudgetBar } from './BudgetBar'
import { budgetFigure, budgetShare } from './budget-figures'
import { categoryTree, useLedger } from './store'

/** Each category's spending this month against its budget, which the user sets here. */
export function BudgetsView() {
  const categories = useLedger((store) => store.categories)
  const refresh = useLedger((store) => store.refresh)
  const home = useLedger((store) => store.settings.homeCurrency)
  const [month, setMonth] = useState(monthOf)
  const [answer, setBudgets] = useState<MonthBudgets | null>(null)
  // An answer for another month is not shown under this one.
  const budgets = answer?.month === month ? answer : null
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
        currency={budgets?.currency ?? home}
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
          <MonthStepper month={month} onChange={setMonth} />
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
              Uncategorized{' '}
              {formatAmount(budgets.uncategorizedCents, budgets.currency)}
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
  currency,
  child,
  onSaved,
}: {
  category: Category
  budget: CategoryBudget
  month: string
  currency: Currency
  child: boolean
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [problem, setProblem] = useState('')
  const state = budgetState(budget)

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

  const label = budgetFigure(budget, currency)

  return (
    <li className={`budget ${state}${child ? ' child' : ''}`}>
      <span className="name">{category.name}</span>
      {budget.budgetCents === null ? (
        <span />
      ) : (
        <BudgetBar share={budgetShare(budget)} />
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
