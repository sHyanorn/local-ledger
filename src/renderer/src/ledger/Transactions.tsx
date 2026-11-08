import { useEffect, useMemo, useRef, useState } from 'react'
import { isIsoDate } from '../../../shared/dates'
import { SEARCH_MAX } from '../../../shared/ledger'
import type { Transaction, TransactionFilter } from '../../../shared/ledger'
import type { RuleSuggestion } from '../../../shared/rules'
import { formatAmount } from '../../../shared/money'
import { Confirm } from '../components/Dialog'
import { AccountDialog } from './AccountDialog'
import { CategoryOptions } from './CategoryOptions'
import { formatDate, periodRange, PERIODS } from './format'
import { chooseImportFile } from './importing'
import type { Period } from './format'
import { RuleSuggestionBar } from './RuleSuggestionBar'
import { categoryName, count, useLedger } from './store'
import { TransactionDialog } from './TransactionDialog'
import { useTransactions } from './useTransactions'

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
        {notice && (
          <div className="suggestion" role="region" aria-label="Notice">
            <p>{notice}</p>
            <button
              type="button"
              className="icon"
              aria-label="Dismiss"
              title="Dismiss"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        )}
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
function totalsText(
  totals: { currency: string; count: number; cents: number }[],
) {
  const transactions = totals.reduce((sum, total) => sum + total.count, 0)
  if (transactions === 0) return ''
  return [
    count(transactions, 'transaction'),
    ...totals.map((total) =>
      formatAmount(
        total.cents,
        total.currency as Parameters<typeof formatAmount>[1],
      ),
    ),
  ].join(' · ')
}

function TransactionTable({
  rows,
  showAccount,
  names,
  more,
  failed,
  onMore,
  onRetry,
  onEdit,
  onCategory,
}: {
  rows: Transaction[]
  showAccount: boolean
  names: Map<number, string>
  more: boolean
  /** Loading the next page failed. */
  failed: boolean
  onMore: () => void
  onRetry: () => void
  onEdit: (row: Transaction) => void
  onCategory: (row: Transaction, value: string) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const more$ = useRef(onMore)
  useEffect(() => {
    more$.current = onMore
  })

  // The next page loads as the end of the list comes within 400 pixels of
  // view. The list scrolls, so it is the root that margin applies to. The
  // observer is set up again after each page, and after a retry.
  useEffect(() => {
    const sentinel = end.current
    if (!sentinel || !more || failed) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) more$.current()
      },
      { root: list.current, rootMargin: '400px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [more, failed, rows.length])

  return (
    <div className="table" role="table" aria-label="Transactions">
      <div
        className={`tr head${showAccount ? ' with-account' : ''}`}
        role="row"
      >
        <span role="columnheader">Date</span>
        <span role="columnheader">Description</span>
        <span role="columnheader">Category</span>
        {showAccount && <span role="columnheader">Account</span>}
        <span role="columnheader" className="amount">
          Amount
        </span>
      </div>
      <div ref={list} role="rowgroup" className="rows">
        {rows.map((row) => (
          <div
            key={row.id}
            role="row"
            className={`tr${showAccount ? ' with-account' : ''}`}
            onDoubleClick={() => onEdit(row)}
          >
            <span role="cell" className="date">
              {formatDate(row.date)}
            </span>
            <span role="cell" className="description">
              <button
                type="button"
                className="link"
                title={row.notes || undefined}
                onClick={() => onEdit(row)}
              >
                {row.description}
              </button>
            </span>
            <span role="cell">
              <CategoryCell
                row={row}
                onChange={onCategory}
                onTransfer={onEdit}
              />
            </span>
            {showAccount && (
              <span role="cell" className="muted">
                {names.get(row.accountId)}
              </span>
            )}
            <span
              role="cell"
              className={`amount${row.amountCents > 0 ? ' positive' : ''}`}
            >
              {formatAmount(row.amountCents, row.currency)}
            </span>
          </div>
        ))}
        {failed && rows.length > 0 && (
          <p className="load-failed" role="alert">
            More transactions could not be loaded.{' '}
            <button type="button" className="secondary" onClick={onRetry}>
              Try Again
            </button>
          </p>
        )}
        <div ref={end} aria-hidden="true" />
      </div>
    </div>
  )
}

/**
 * The row's category as text; a click turns it into a picker. A select in
 * every row would put every category in the page thousands of times over.
 */
function CategoryCell({
  row,
  onChange,
  onTransfer,
}: {
  row: Transaction
  onChange: (row: Transaction, value: string) => void
  /** A transfer has no category; its cell opens the transaction instead. */
  onTransfer: (row: Transaction) => void
}) {
  const categories = useLedger((store) => store.categories)
  const accounts = useLedger((store) => store.accounts)
  const [picking, setPicking] = useState(false)
  const select = useRef<HTMLSelectElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  // After a choice or Escape, focus returns to the cell, so a keyboard user
  // can go on down the list.
  const refocus = useRef(false)

  useEffect(() => {
    if (!picking) {
      if (refocus.current) button.current?.focus()
      refocus.current = false
      return
    }
    select.current?.focus()
    // Opens straight away; the click that asked for it allows that.
    try {
      select.current?.showPicker()
    } catch {
      // Without the click's activation the select stays focused, closed.
    }
  }, [picking])

  const close = () => {
    refocus.current = true
    setPicking(false)
  }

  if (row.transferAccountId !== null) {
    const other = accounts.find(
      (account) => account.id === row.transferAccountId,
    )
    return (
      <button
        type="button"
        className="inline muted"
        aria-label={`${row.description} is a transfer with ${other?.name ?? 'another account'}`}
        onClick={() => onTransfer(row)}
      >
        Transfer · {other?.name}
      </button>
    )
  }

  if (!picking) {
    const known = categoryName(categories, row.categoryId)
    const name = known ?? 'Uncategorized'
    return (
      <button
        ref={button}
        type="button"
        className={`inline${known ? '' : ' muted'}`}
        aria-label={`Category of ${row.description}: ${name}`}
        onClick={() => setPicking(true)}
      >
        {name}
      </button>
    )
  }

  return (
    <select
      ref={select}
      aria-label={`Category of ${row.description}`}
      className="inline"
      value={row.categoryId ?? ''}
      onChange={(event) => {
        close()
        onChange(row, event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        close()
      }}
      onBlur={() => setPicking(false)}
    >
      <option value="">Uncategorized</option>
      <CategoryOptions />
    </select>
  )
}
