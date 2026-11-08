import { useCallback, useEffect, useRef, useState } from 'react'
import { PAGE_MAX } from '../../../shared/ledger'
import type {
  CurrencyTotal,
  Transaction,
  TransactionCursor,
  TransactionFilter,
} from '../../../shared/ledger'

const PAGE = 200

interface Loaded {
  /** The filter these rows match, as JSON. */
  key: string
  rows: Transaction[]
  totals: CurrencyTotal[]
  next: TransactionCursor | null
  failed: boolean
}

/**
 * The transactions matching a filter, newest first, a page at a time, and
 * their totals per currency. Until a new filter's rows arrive the old ones
 * stay. Each load starts a generation; a page from an older one is dropped.
 */
export function useTransactions(filter: TransactionFilter) {
  const key = JSON.stringify(filter)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [paging, setPaging] = useState(false)
  const [pageFailed, setPageFailed] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    const id = ++generation.current
    void fetchRows(key, PAGE).then((result) => {
      if (id !== generation.current) return
      setLoaded(result)
      setPageFailed(false)
    })
  }, [key])

  const current = loaded?.key === key ? loaded : null
  const shown = current?.rows.length ?? 0

  /**
   * Loads again every row shown so far, with the totals, so a change shows
   * where it belongs and the reader keeps their place.
   */
  const refresh = useCallback(async () => {
    const id = ++generation.current
    const result = await fetchRows(key, Math.max(shown, PAGE))
    if (id !== generation.current) return
    setLoaded(result)
    setPageFailed(false)
  }, [key, shown])

  const loadMore = useCallback(async () => {
    if (!current?.next || paging || pageFailed) return
    const id = generation.current
    setPaging(true)
    try {
      const page = await window.ledger.transactions.page(
        JSON.parse(key) as TransactionFilter,
        PAGE,
        current.next,
      )
      if (id !== generation.current) return
      setLoaded((before) =>
        before?.key === key
          ? { ...before, rows: [...before.rows, ...page.rows], next: page.next }
          : before,
      )
    } catch {
      // Shown with a way to try again; never retried on its own.
      if (id === generation.current) setPageFailed(true)
    } finally {
      setPaging(false)
    }
  }, [current, key, paging, pageFailed])

  /** Shows a saved change in place, without loading anything. */
  const replace = useCallback((row: Transaction) => {
    setLoaded(
      (before) =>
        before && {
          ...before,
          rows: before.rows.map((candidate) =>
            candidate.id === row.id ? row : candidate,
          ),
        },
    )
  }, [])

  return {
    rows: loaded?.rows ?? [],
    totals: loaded?.totals ?? [],
    more: Boolean(current?.next),
    loading: !current || paging,
    failed: current?.failed ?? false,
    pageFailed,
    refresh,
    loadMore,
    retry: () => setPageFailed(false),
    replace,
  }
}

/** The first `count` matching rows, a page at a time, and the totals. */
async function fetchRows(key: string, count: number): Promise<Loaded> {
  const filter = JSON.parse(key) as TransactionFilter
  try {
    const rows: Transaction[] = []
    let next: TransactionCursor | null = null
    do {
      const page = await window.ledger.transactions.page(
        filter,
        Math.min(PAGE_MAX, count - rows.length),
        next ?? undefined,
      )
      rows.push(...page.rows)
      next = page.next
    } while (next && rows.length < count)
    const totals = await window.ledger.transactions.totals(filter)
    return { key, rows, totals, next, failed: false }
  } catch {
    return { key, rows: [], totals: [], next: null, failed: true }
  }
}
