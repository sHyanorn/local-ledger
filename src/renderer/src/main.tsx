import './index.css'
import '../../shared/charts.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// Styles that differ by platform key off this, such as the macOS sidebar.
document.documentElement.dataset.platform = window.ledger.platform

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
