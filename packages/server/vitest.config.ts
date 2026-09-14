import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    globals: false,
    // The XiaoBao ledger concurrency tests open real worker threads and independent SQLite
    // connections. Under the default thread pool these contend with Vitest's own workers and
    // fail intermittently; a single forked worker serializes files deterministically and is
    // measurably faster overall (no contention retries).
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@ai-xiaobao/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
})
