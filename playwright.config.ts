import { defineConfig } from '@playwright/test'

// Tests launch the compiled, unpackaged app with Electron. The packaged app
// cannot be driven: the fuses turn off --inspect and the app refuses a remote
// debugging port, both of which Playwright needs. Its self-test covers it.
export default defineConfig({
  testDir: 'tests/e2e',
  tsconfig: 'tests/e2e/tsconfig.json',
  timeout: 30_000,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  use: {
    trace: 'off',
    screenshot: 'only-on-failure',
  },
})
