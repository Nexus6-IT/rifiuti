import { defineConfig, devices } from '@playwright/test'
import { getBaseUrl, isProductionTarget } from './utils/env'
import { runId } from './utils/run-id'

const baseURL = getBaseUrl()
const targetingProduction = isProductionTarget(baseURL)

// Genera (o riusa, se già impostato da fuori) il prefisso di run PRIMA che
// Playwright avvii i worker: i worker sono processi figli che ereditano
// l'ambiente del processo di config al fork, quindi impostare qui
// E2E_RUN_ID (side-effect di runId(), vedi utils/run-id.ts) è l'unico modo
// per garantire che tutti i worker — e il globalTeardown sotto, che gira
// nello stesso processo di config — condividano lo stesso prefisso.
runId()

// Fail fast e rumoroso se qualcuno punta a produzione senza il flag esplicito
// E2E_ALLOW_PROD_RUN=1 (impostato dallo script `e2e:prod`, mai di default).
if (targetingProduction && process.env.E2E_ALLOW_PROD_RUN !== '1') {
  throw new Error(
    `[SAFETY] E2E_BASE_URL="${baseURL}" punta a un ambiente non-locale, ma E2E_ALLOW_PROD_RUN non è impostato a "1". ` +
      `Per eseguire volutamente la suite contro produzione usa "npm run e2e:prod" (vedi e2e/README.md). ` +
      `Per l'esecuzione locale normale, non impostare E2E_BASE_URL (default http://localhost:4200) oppure puntalo a un host locale.`
  )
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  // Teardown globale: pulisce le risorse registrate durante la run (vedi
  // fixtures/risorse.ts) e fallisce l'intera run se ne resta un residuo
  // (vedi scripts/verifica-residuo.ts). Idempotente — vale anche dopo una
  // run interrotta a metà.
  globalTeardown: require.resolve('./scripts/verifica-residuo.ts'),
  expect: {
    timeout: 5_000,
  },
  reporter: [['html', { open: 'never', outputFolder: '../e2e-report' }], ['list']],
  outputDir: '../test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    navigationTimeout: 15_000,
    actionTimeout: 10_000,
  },
  // Chromium è il progetto di default (script `npm run e2e`). Firefox/WebKit
  // sono definiti per uso opzionale/esplicito: `npx playwright test --project=firefox`
  // (non fanno parte della run di default per contenere i tempi in CI).
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
})
