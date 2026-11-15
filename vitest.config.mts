import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Windows runners write files slowly enough that tests and hooks that
    // make databases pass the default limits, a different one each run.
    ...(process.platform === 'win32'
      ? { testTimeout: 30_000, hookTimeout: 30_000 }
      : {}),
  },
})
