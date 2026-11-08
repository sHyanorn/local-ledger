import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  main: {},
  preload: {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  },
  renderer: {
    plugins: [react()],
  },
})
