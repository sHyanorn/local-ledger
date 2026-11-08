import { useState } from 'react'
import { useVault } from '../store'
import { ChangePassword } from './ChangePassword'

export function Home() {
  const lock = useVault((store) => store.lock)
  const [changing, setChanging] = useState(false)

  if (changing) return <ChangePassword onCancel={() => setChanging(false)} />

  return (
    <main className="home">
      <header className="toolbar">
        <h1>Local Ledger</h1>
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => setChanging(true)}
          >
            Change Password…
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void lock()}
          >
            Lock
          </button>
        </div>
      </header>
    </main>
  )
}
