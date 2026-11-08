import { useState } from 'react'
import { CURRENCIES, type Currency } from '../../../shared/money'
import {
  IDLE_LOCK_CHOICES,
  type IdleLockMinutes,
  type Settings,
} from '../../../shared/settings'
import { Confirm } from '../components/Dialog'
import { ErrorText } from '../components/ErrorText'
import { count, monthOf } from './format'
import { useLedger } from './store'

/** The home currency for budgets, and how long the computer may sit idle before the vault locks. */
export function GeneralSection() {
  const settings = useLedger((store) => store.settings)
  const refresh = useLedger((store) => store.refresh)
  const [changing, setChanging] = useState<{
    currency: Currency
    budgets: number
  } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const update = async (changes: Partial<Settings>) => {
    setProblem(null)
    try {
      await window.ledger.settings.update(changes)
      await refresh()
    } catch {
      setProblem('The setting could not be saved.')
    }
  }

  const chooseCurrency = async (currency: Currency) => {
    const budgets = await window.ledger.budgets.month(monthOf())
    const set = budgets.categories.filter(
      (budget) => budget.budgetCents !== null,
    ).length
    if (set === 0) return update({ homeCurrency: currency })
    setChanging({ currency, budgets: set })
  }

  return (
    <section aria-labelledby="general-heading">
      <h2 id="general-heading">General</h2>
      <div className="form general">
        <label>
          Home currency
          <select
            value={settings.homeCurrency}
            onChange={(event) =>
              void chooseCurrency(event.target.value as Currency)
            }
          >
            {CURRENCIES.map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </label>
        <label>
          Lock after idle
          <select
            value={settings.idleLockMinutes}
            onChange={(event) =>
              void update({
                idleLockMinutes: Number(event.target.value) as IdleLockMinutes,
              })
            }
          >
            {IDLE_LOCK_CHOICES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 1 ? '1 minute' : `${minutes} minutes`}
              </option>
            ))}
          </select>
        </label>
        <ErrorText message={problem} />
      </div>
      {changing && (
        <Confirm
          title={`Count budgets in ${changing.currency}?`}
          message={`${count(changing.budgets, 'budget')} will count spending in ${changing.currency}; amounts are not converted.`}
          action="Change Currency"
          onConfirm={() => {
            const { currency } = changing
            setChanging(null)
            void update({ homeCurrency: currency })
          }}
          onCancel={() => setChanging(null)}
        />
      )}
    </section>
  )
}
