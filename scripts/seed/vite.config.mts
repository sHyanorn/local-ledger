// Bundles the seed script for Node; its dependencies stay external.
import { defineConfig } from 'vite'

export default defineConfig({
  logLevel: 'warn',
  build: {
    ssr: 'scripts/seed/index.ts',
    outDir: '.demo/seed',
    emptyOutDir: true,
    target: 'node24',
    rollupOptions: { output: { entryFileNames: 'seed.mjs' } },
  },
})
