import { useCallback, useEffect, useState, type DependencyList } from 'react'
import { useLedger } from './store'

/**
 * What `load` answers, loaded again when `deps` change, after each reload of
 * the ledger, and on `reload`. `value` is null until the first answer and
 * after a failure, which `failed` tells apart from no answer yet.
 */
export function useLoaded<T>(
  load: () => Promise<T>,
  deps: DependencyList,
): { value: T | null; failed: boolean; reload: () => void } {
  const revision = useLedger((store) => store.revision)
  const [requests, setRequests] = useState(0)
  const [state, setState] = useState<{ value: T | null; failed: boolean }>({
    value: null,
    failed: false,
  })

  // `load` is a new function on every render; `deps` name what it reads.
  /* oxlint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    let current = true
    load().then(
      (value) => current && setState({ value, failed: false }),
      () => current && setState({ value: null, failed: true }),
    )
    return () => {
      current = false
    }
  }, [...deps, revision, requests])
  /* oxlint-enable react-hooks/exhaustive-deps */

  const reload = useCallback(() => setRequests((count) => count + 1), [])
  return { ...state, reload }
}
