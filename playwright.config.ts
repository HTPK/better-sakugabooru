import { defineConfig } from '@playwright/test'

// Live-site smoke test. The site is volunteer-run: one serial test, no retries,
// at most ~10 page loads per run (see test/smoke/extension.spec.ts).
export default defineConfig({
  testDir: 'test/smoke',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 60_000,
  reporter: 'list',
})
