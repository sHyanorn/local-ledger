import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        // The vault host runs in a utility process of its own.
        input: { index: 'src/main/index.ts', host: 'src/main/host.ts' },
        experimental: { attachDebugInfo: 'none' },
      },
    },
  },
  preload: {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  },
  renderer: {
    plugins: [react()],
  },
})
