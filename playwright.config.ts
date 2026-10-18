// End-to-end tests (web-stack §10, architecture §11.7): Chromium against the real server on port 18787, which serves the
// built client (`npm run e2e` builds it first). The web server command prepares data/e2e (config plus the Mini-GT
// export) before the server starts, so the data always exists and every run starts from an empty project database.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://127.0.0.1:18787', ...devices['Desktop Chrome'] },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning tests/e2e/prepare.ts && node --disable-warning=ExperimentalWarning src/server/main.ts',
    url: 'http://127.0.0.1:18787/api/health',
    reuseExistingServer: false,
    env: { GTNH_PLANNER_CONFIG: 'data/e2e/config.json' },
  },
});
