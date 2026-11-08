import { useEffect } from 'react'
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
  }
}
