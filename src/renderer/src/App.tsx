import { useEffect } from 'react'
import { ErrorText } from './components/ErrorText'
import { Damaged } from './screens/Damaged'
import { Ledger } from './ledger/Ledger'
import { Setup } from './screens/Setup'
import { Unlock } from './screens/Unlock'
import { useVault } from './store'

export function App() {
  const state = useVault((store) => store.state)
  const load = useVault((store) => store.load)

  useEffect(() => {
    void load()
  }, [load])

  switch (state) {
    case 'loading':
      return null
    case 'new':
      return <Setup />
    case 'locked':
      return <Unlock />
    case 'unlocked':
      return <Ledger />
    case 'damaged':
      return <Damaged />
    case 'unreadable':
      return (
        <main className="gate">
          <section className="panel">
            <h1>Local Ledger</h1>
            <ErrorText message="The vault could not be read. Quit Local Ledger and open it again." />
          </section>
        </main>
      )
  }
}
