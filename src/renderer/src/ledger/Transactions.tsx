import { useEffect, useMemo, useRef, useState } from 'react'
import { NoticeBar } from '../components/NoticeBar'
import { isIsoDate } from '../../../shared/dates'
import { SEARCH_MAX } from '../../../shared/ledger'
import type {
  CurrencyTotal,
  Transaction,
  TransactionFilter,
} from '../../../shared/ledger'
import type { RuleSuggestion } from '../../../shared/rules'
import { formatAmount } from '../../../shared/money'
import { Confirm } from '../components/Dialog'
import { AccountDialog } from './AccountDialog'
import { CategoryOptions } from './CategoryOptions'
import { count, periodRange, PERIODS } from './format'
import { chooseImportFile } from './importing'
import type { Period } from './format'
import { RuleSuggestionBar } from './RuleSuggestionBar'
import { useLedger } from './store'
import { TransactionDialog } from './TransactionDialog'
import { useTransactions } from './useTransactions'
import { TransactionTable } from './TransactionTable'

type Editing = { transaction?: Transaction } | null

const DATE_MIN = '1900-01-01'
const DATE_MAX = '2999-12-31'

export function Transactions({ accountId }: { accountId: number | null }) {
  const accounts = useLedger((store) => store.accounts)
  const refreshLedger = useLedger((store) => store.refresh)
  const show = useLedger((store) => store.show)
  const [importProblem, setImportProblem] = useState('')
  const [suggestion, setSuggestion] = useState<RuleSuggestion | null>(null)
  const notice = useLedger((store) => store.notice)
  const setNotice = useLedger((store) => store.setNotice)
  const account = accounts.find((candidate) => candidate.id === accountId)
  const [search, setSearch] = useState('')
  const [text, setText] = useState('')
  const [category, setCategory] = useState('')
  const [period, setPeriod] = useState<Period>('all')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [editing, setEditing] = useState<Editing>(null)
  const [editingAccount, setEditingAccount] = useState(false)
  const searchField = useRef<HTMLInputElement>(null)
  // ⌘N and ⌘F from the menu, also when they brought this list up.
  useEffect(() => {
    const act = (command: 'new-transaction' | 'find') => {
      const store = useLedger.getState()
      store.done()
      if (command === 'find') {
        searchField.current?.focus()
        searchField.current?.select()
      } else if (store.accounts.length > 0) {
        setEditing({})
      }
    }
    const waiting = useLedger.getState().request
    if (waiting) act(waiting.command)
    return useLedger.subscribe((state, before) => {
      if (state.request && state.request !== before.request)
        act(state.request.command)
    })
  }, [])

  // Searching waits for a pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => setText(search), 200)
    return () => clearTimeout(timer)
  }, [search])

  const filter = useMemo((): TransactionFilter => {
    // A custom bound counts once it is a whole date in range.
    const range =
      period === 'custom'
        ? {
            ...(isIsoDate(custom.from) ? { from: custom.from } : {}),
            ...(isIsoDate(custom.to) ? { to: custom.to } : {}),
          }
        : periodRange(period)
    return {
      ...(accountId === null ? {} : { accountId }),
      ...(category === ''
        ? {}
        : { category: category === 'none' ? 'none' : Number(category) }),
      ...range,
      ...(text.trim() ? { text: text.trim() } : {}),
    }
  }, [accountId, category, period, custom, text])

  const list = useTransactions(filter)
  const narrowed = Object.keys(filter).some((key) => key !== 'accountId')
  const names = useMemo(
    () => new Map(accounts.map((option) => [option.id, option.name])),
    [accounts],
  )

  // After a change the list and the sidebar load again, keeping the place.
  const saved = () => {
    void list.refresh()
    void refreshLedger()
  }

  /** After the user sets a category, a rule may be worth offering. */
  const suggestion$ = useRef(0)
  const suggestFor = (id: number) => {
    // Only the answer for the latest change counts.
    const asked = ++suggestion$.current
    const answer = (value: RuleSuggestion | null) => {
      if (asked === suggestion$.current) setSuggestion(value)
    }
    window.ledger.rules.suggest(id).then(answer, () => answer(null))
  }

  const startImport = async () => {
    try {
      const chosen = await chooseImportFile()
      if (!chosen) return
      if ('problem' in chosen) setImportProblem(chosen.problem)
      else show({ name: 'import', file: chosen.file, accountId })
    } catch {
      setImportProblem('The file could not be opened.')
    }
  }

  const recategorize = async (row: Transaction, value: string) => {
    const categoryId = value === '' ? null : Number(value)
    try {
      const result = await window.ledger.transactions.setCategory(
        row.id,
        categoryId,
      )
      // Under a category filter the row may no longer belong in the list.
      if (result.ok && filter.category === undefined) {
        list.replace({ ...row, categoryId })
      } else {
        void list.refresh()
      }
      if (result.ok && categoryId !== null) suggestFor(row.id)
      void refreshLedger()
    } catch {
      void list.refresh()
    }
  }

  return (
    <div className="content">
      <header className="toolbar">
        <h1>{account?.name ?? 'All Transactions'}</h1>
        <div className="actions">
          {account && (
            <button
              type="button"
              className="secondary"
              onClick={() => setEditingAccount(true)}
            >
              Edit Account…
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={accounts.length === 0}
            onClick={() => void startImport()}
          >
            Import CSV…
          </button>
          <button
            type="button"
            disabled={accounts.length === 0}
            onClick={() => setEditing({})}
          >
            Add Transaction
          </button>
        </div>
      </header>

      <div className="filters" role="search">
        <input
          ref={searchField}
          type="search"
          aria-label="Search"
          placeholder="Search"
          maxLength={SEARCH_MAX}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">All Categories</option>
          <option value="none">Uncategorized</option>
          <CategoryOptions />
        </select>
        <select
          aria-label="Period"
          value={period}
          onChange={(event) => setPeriod(event.target.value as Period)}
        >
          {Object.entries(PERIODS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {period === 'custom' && (
          <>
            <input
              type="date"
              aria-label="From"
              min={DATE_MIN}
              max={DATE_MAX}
              value={custom.from}
              onChange={(event) =>
                setCustom({ ...custom, from: event.target.value })
              }
            />
            <input
              type="date"
              aria-label="To"
              min={DATE_MIN}
              max={DATE_MAX}
              value={custom.to}
              onChange={(event) =>
                setCustom({ ...custom, to: event.target.value })
              }
            />
          </>
        )}
        <p className="totals" aria-live="polite">
          {totalsText(list.totals)}
        </p>
      </div>

      <TransactionTable
        rows={list.rows}
        showAccount={accountId === null}
        names={names}
        more={list.more}
        failed={list.pageFailed}
        onMore={() => void list.loadMore()}
        onRetry={list.retry}
        onEdit={(transaction) => setEditing({ transaction })}
        onCategory={(row, value) => void recategorize(row, value)}
      />
      {!list.loading && list.rows.length === 0 && (
        <p className="empty">
          {list.failed
            ? 'The transactions could not be loaded.'
            : narrowed
              ? 'No matching transactions'
              : 'No transactions'}
        </p>
      )}

      {editing && (
        <TransactionDialog
          {...editing}
          {...(accountId === null ? {} : { accountId })}
          onSaved={(categorized) => {
            saved()
            if (categorized !== undefined) suggestFor(categorized)
          }}
          onClose={() => setEditing(null)}
        />
      )}
      <div aria-live="polite">
        <NoticeBar message={notice} onDismiss={() => setNotice(null)} />
        {suggestion && (
          <RuleSuggestionBar
            key={`${suggestion.pattern}:${suggestion.categoryId}`}
            suggestion={suggestion}
            onDone={(changed) => {
              setSuggestion(null)
              if (changed) saved()
            }}
          />
        )}
      </div>
      {importProblem && (
        <Confirm
          title="Can’t Import File"
          message={importProblem}
          onCancel={() => setImportProblem('')}
        />
      )}
      {editingAccount && account && (
        <AccountDialog
          account={account}
          onClose={() => setEditingAccount(false)}
        />
      )}
    </div>
  )
}

/** "1,204 transactions · $12,345.67 · CNY 1,383.14": each currency on its own. */
function totalsText(totals: CurrencyTotal[]) {
  const transactions = totals.reduce((sum, total) => sum + total.count, 0)
  if (transactions === 0) return ''
  return [
    count(transactions, 'transaction'),
    ...totals.map((total) => formatAmount(total.cents, total.currency)),
  ].join(' · ')
}
