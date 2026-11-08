import { useCallback, useEffect, useRef, useState } from 'react'
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
 * stay; a response for an older request is dropped.
 */
export function useTransactions(filter: TransactionFilter) {
  const key = JSON.stringify(filter)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [paging, setPaging] = useState(false)
  const request = useRef(0)

  const reload = useCallback(async () => {
    const id = ++request.current
    const result = await firstPage(key)
    if (id === request.current) setLoaded(result)
  }, [key])

  useEffect(() => {
    const id = ++request.current
    void firstPage(key).then((result) => {
      if (id === request.current) setLoaded(result)
    })
  }, [key])

  const current = loaded?.key === key ? loaded : null

  const loadMore = useCallback(async () => {
    if (!current?.next || paging) return
    const id = ++request.current
    setPaging(true)
    try {
      const page = await window.ledger.transactions.page(
        JSON.parse(key) as TransactionFilter,
        PAGE,
        current.next,
      )
      if (id !== request.current) return
      setLoaded({
        ...current,
        rows: [...current.rows, ...page.rows],
        next: page.next,
      })
    } catch {
      if (id === request.current) setLoaded({ ...current, failed: true })
    } finally {
      setPaging(false)
    }
  }, [current, key, paging])

  /** Shows a saved change in place, without reloading the list. */
  const replace = useCallback((row: Transaction) => {
    setLoaded(
      (shown) =>
        shown && {
          ...shown,
          rows: shown.rows.map((candidate) =>
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
    reload,
    loadMore,
    replace,
  }
}

async function firstPage(key: string): Promise<Loaded> {
  const filter = JSON.parse(key) as TransactionFilter
  try {
    const [page, totals] = await Promise.all([
      window.ledger.transactions.page(filter, PAGE),
      window.ledger.transactions.totals(filter),
    ])
    return { key, rows: page.rows, totals, next: page.next, failed: false }
  } catch {
    return { key, rows: [], totals: [], next: null, failed: true }
  }
}
