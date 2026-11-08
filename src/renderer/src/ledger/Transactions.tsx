import { useEffect, useMemo, useRef, useState } from 'react'
import { SEARCH_MAX } from '../../../shared/ledger'
import type { Transaction, TransactionFilter } from '../../../shared/ledger'
import { formatAmount } from '../../../shared/money'
import { AccountDialog } from './AccountDialog'
import { CategoryOptions } from './CategoryOptions'
import { formatDate, periodRange, PERIODS } from './format'
import type { Period } from './format'
import { count, useLedger } from './store'
import { TransactionDialog } from './TransactionDialog'
import { useTransactions } from './useTransactions'

type Editing = { transaction?: Transaction } | null

export function Transactions({ accountId }: { accountId: number | null }) {
  const accounts = useLedger((store) => store.accounts)
  const refresh = useLedger((store) => store.refresh)
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
    const range =
      period === 'custom'
        ? {
            ...(custom.from ? { from: custom.from } : {}),
            ...(custom.to ? { to: custom.to } : {}),
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
  const { reload } = list
  const narrowed = Object.keys(filter).some((key) => key !== 'accountId')
  const names = useMemo(
    () => new Map(accounts.map((option) => [option.id, option.name])),
    [accounts],
  )

  const saved = () => {
    void reload()
    void refresh()
  }

  const recategorize = async (row: Transaction, value: string) => {
    const categoryId = value === '' ? null : Number(value)
    const { id, currency: _currency, ...fields } = row
    try {
      const result = await window.ledger.transactions.update({
        id,
        ...fields,
        categoryId,
      })
      if (result.ok) list.replace({ ...row, categoryId })
      void refresh()
    } catch {
      void reload()
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
              value={custom.from}
              onChange={(event) =>
                setCustom({ ...custom, from: event.target.value })
              }
            />
            <input
              type="date"
              aria-label="To"
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
        onMore={() => void list.loadMore()}
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
          onSaved={saved}
          onClose={() => setEditing(null)}
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
  onMore,
  onEdit,
  onCategory,
}: {
  rows: Transaction[]
  showAccount: boolean
  names: Map<number, string>
  more: boolean
  onMore: () => void
  onEdit: (row: Transaction) => void
  onCategory: (row: Transaction, value: string) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)

  // The next page loads as the end of the list comes within 400 pixels of
  // view. The list scrolls, so it is the root that margin applies to.
  useEffect(() => {
    const sentinel = end.current
    if (!sentinel || !more) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onMore()
      },
      { root: list.current, rootMargin: '400px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [more, onMore, rows.length])

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
              <CategoryCell row={row} onChange={onCategory} />
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
}: {
  row: Transaction
  onChange: (row: Transaction, value: string) => void
}) {
  const categories = useLedger((store) => store.categories)
  const [picking, setPicking] = useState(false)
  const select = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    if (!picking) return
    select.current?.focus()
    // Opens straight away; the click that asked for it allows that.
    try {
      select.current?.showPicker()
    } catch {
      // Without the click's activation the select stays focused, closed.
    }
  }, [picking])

  if (!picking) {
    const category = categories.find((option) => option.id === row.categoryId)
    const parent = categories.find((option) => option.id === category?.parentId)
    const name = category
      ? parent
        ? `${parent.name} › ${category.name}`
        : category.name
      : 'Uncategorized'
    return (
      <button
        type="button"
        className={`inline${category ? '' : ' muted'}`}
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
        setPicking(false)
        onChange(row, event.target.value)
      }}
      onBlur={() => setPicking(false)}
    >
      <option value="">Uncategorized</option>
      <CategoryOptions />
    </select>
  )
}
