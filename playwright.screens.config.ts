import { defineConfig } from '@playwright/test'

// Screenshots and the GIF for the README, from the seeded fake ledger:
// npm run screenshots. Not part of the test suite.
export default defineConfig({
  testDir: 'tests/screenshots',
  tsconfig: 'tests/e2e/tsconfig.json',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'off' },
})
