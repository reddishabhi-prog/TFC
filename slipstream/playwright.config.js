import { defineConfig, devices } from '@playwright/test'

const PORT = 5199

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,   // one shared SQLite file; parallel writes would race
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Pixel 5'],
    trace: 'retain-on-failure',
    // Use the Chromium already on the machine. PLAYWRIGHT_CHROMIUM_PATH lets
    // CI point somewhere else; the default suits this container, where the
    // pinned Playwright's own browser build is not downloaded.
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    },
  },
  // Serves the built SPA and the API from one origin, against a throwaway DB.
  webServer: {
    command: `node server/index.js`,
    port: PORT,
    reuseExistingServer: false,
    env: { PORT: String(PORT), SLIPSTREAM_DB: 'data/test.db' },
    stdout: 'ignore',
  },
})
