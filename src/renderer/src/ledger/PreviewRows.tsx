import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { PreviewRow } from '../../../shared/imports'
import { formatAmount, type Currency } from '../../../shared/money'
import { formatDate } from './format'
import { categoryName, useLedger } from './store'

/** Rows are this tall (index.css), which lets the list draw only those in view. */
const ROW_HEIGHT = 35
/** Rows drawn beyond the visible ones, so scrolling does not show gaps. */
const OVERSCAN = 20

/**
 * The preview rows, drawn only around what is in view: a file can hold
 * 50,000 rows, and drawing them all takes seconds. Each row keeps its
 * aria-rowindex, so assistive technology knows where it is in the whole.
 */
export function PreviewRows({
  rows,
  selected,
  onToggle,
  groups,
  currencies,
  names,
}: {
  rows: PreviewRow[]
  selected: Set<number>
  onToggle: (index: number, on: boolean) => void
  groups: boolean
  currencies: Map<number, Currency>
  names: Map<number, string>
}) {
  const list = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, height: 800 })

  useLayoutEffect(() => {
    const element = list.current
    if (!element) return
    const measure = () =>
      setView({ top: element.scrollTop, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', measure)
    }
  }, [])

  // A scroll position from a longer list, before the browser clamps it,
  // must still draw the rows that are there.
  const last = Math.min(
    rows.length,
    Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN,
  )
  const first = Math.max(
    0,
    Math.min(
      Math.floor(view.top / ROW_HEIGHT) - OVERSCAN,
      last - Math.ceil(view.height / ROW_HEIGHT) - OVERSCAN,
    ),
  )

  return (
    <div role="rowgroup" className="rows" ref={list}>
      <div style={{ height: first * ROW_HEIGHT }} aria-hidden="true" />
      {rows.slice(first, last).map((row, offset) => (
        <PreviewRowView
          key={row.index}
          row={row}
          position={first + offset + 2}
          checked={selected.has(row.index)}
          onToggle={onToggle}
          groups={groups}
          currency={currencies.get(row.accountId) ?? 'AUD'}
          account={names.get(row.accountId)}
        />
      ))}
      <div
        style={{ height: (rows.length - last) * ROW_HEIGHT }}
        aria-hidden="true"
      />
    </div>
  )
}

const PreviewRowView = memo(function PreviewRowView({
  row,
  position,
  checked,
  onToggle,
  groups,
  currency,
  account,
}: {
  row: PreviewRow
  /** The row's place in the table, the header being 1. */
  position: number
  checked: boolean
  onToggle: (index: number, on: boolean) => void
  groups: boolean
  currency: Currency
  account: string | undefined
}) {
  const categories = useLedger((store) => store.categories)
  return (
    <div
      role="row"
      aria-rowindex={position}
      className={`tr preview${groups ? ' with-account' : ''}`}
    >
      <span role="cell">
        <input
          type="checkbox"
          aria-label={`Import ${row.description}`}
          checked={checked}
          onChange={(event) => onToggle(row.index, event.target.checked)}
        />
      </span>
      <span role="cell" className="date">
        {formatDate(row.date)}
      </span>
      <span role="cell" title={row.description}>
        {row.description}
      </span>
      <span
        role="cell"
        className={row.categoryId === null ? 'muted' : undefined}
      >
        {categoryName(categories, row.categoryId) ?? 'Uncategorized'}
      </span>
      {groups && (
        <span role="cell" className="muted">
          {account}
        </span>
      )}
      <span
        role="cell"
        className={`amount${row.amountCents > 0 ? ' positive' : ''}`}
      >
        {formatAmount(row.amountCents, currency)}
      </span>
      <span
        role="cell"
        className="muted"
        title={row.match ? row.match.description : undefined}
      >
        {row.match &&
          `${formatDate(row.match.date)} · ${row.match.description}`}
      </span>
    </div>
  )
})
