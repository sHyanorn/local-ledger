import { useEffect, useRef, useState } from 'react'
import type { Transaction } from '../../../shared/ledger'
import { formatAmount } from '../../../shared/money'
import { CategoryOptions } from './CategoryOptions'
import { formatDate } from './format'
import { categoryName, useLedger } from './store'

export function TransactionTable({
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
    // The name starts with the text shown, as speech input expects.
    const shown = `Transfer · ${other?.name ?? 'another account'}`
    return (
      <button
        type="button"
        className="inline muted"
        aria-label={`${shown}: ${row.description}`}
        onClick={() => onTransfer(row)}
      >
        {shown}
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
