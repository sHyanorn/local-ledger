import { defineConfig } from '@playwright/test'

// Tests launch the compiled, unpackaged app with Electron. The packaged app
// cannot be driven: Playwright needs --inspect, which the fuses turn off.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  use: {
    trace: 'off',
    screenshot: 'only-on-failure',
  },
})
