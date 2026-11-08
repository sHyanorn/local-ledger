// Bundles the csv:shape script for Node; its dependencies stay external.
import { defineConfig } from 'vite'

export default defineConfig({
  logLevel: 'warn',
  build: {
    ssr: 'scripts/csv-shape/index.ts',
    outDir: '.demo/csv-shape',
    emptyOutDir: true,
    target: 'node24',
    rollupOptions: { output: { entryFileNames: 'csv-shape.mjs' } },
  },
})
