import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['vitest.setup.ts'],
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
    // Process theme CSS so `?inline` imports yield real text (Vitest stubs CSS to '' by default).
    css: { include: [/src[\\/]theme[\\/].+\.css/] },
  },
})
