import { useVault } from '../store'

export function Home() {
  const lock = useVault((store) => store.lock)

  return (
    <main className="home">
      <header className="toolbar">
        <h1>Local Ledger</h1>
        <button type="button" className="secondary" onClick={() => void lock()}>
          Lock
        </button>
      </header>
    </main>
  )
}
