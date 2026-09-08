import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      DEV_MODE: 'true',
      DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/local',
      RETAIL_DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/local',
      BETTER_AUTH_SECRET: 'playwright-local-secret-at-least-32-characters',
      BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
