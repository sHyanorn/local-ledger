import { useState } from 'react'
import { RestoreDialog } from './RestoreDialog'

export function Damaged() {
  const [restoring, setRestoring] = useState(false)
  return (
    <main className="gate">
      <section className="panel">
        <h1>This vault cannot be opened</h1>
        <p>
          Its files are missing or damaged. Restore a backup; the damaged files
          are moved aside, not deleted.
        </p>
        <button type="button" onClick={() => setRestoring(true)}>
          Restore from Backup…
        </button>
      </section>
      {restoring && (
        <RestoreDialog replacing={false} onClose={() => setRestoring(false)} />
      )}
    </main>
  )
}
