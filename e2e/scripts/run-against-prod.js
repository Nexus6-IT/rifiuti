#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Wrapper esplicito per eseguire la suite E2E contro produzione
 * (https://rifiuti.ignicraft.com). Non esiste un modo implicito di puntare
 * a produzione: playwright.config.ts rifiuta di partire se E2E_BASE_URL è
 * non-locale e E2E_ALLOW_PROD_RUN non è "1" — questo script è l'UNICO punto
 * che imposta quel flag.
 *
 * Di default esegue SOLO la suite `tests/public/` (read-only, sicura da
 * eseguire contro l'ambiente live). Per eseguire altro contro produzione
 * (sconsigliato — richiede credenziali reali e tocca dati veri) passare
 * esplicitamente un pattern: `npm run e2e:prod -- tests/auth`.
 *
 * Vedi e2e/README.md § "Eseguire contro produzione".
 */

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const PRODUCTION_BASE_URL = 'https://rifiuti.ignicraft.com'
const extraArgs = process.argv.slice(2)
const testPattern = extraArgs.length > 0 ? extraArgs : ['tests/public']

console.log(`[e2e:prod] Target: ${PRODUCTION_BASE_URL}`)
console.log(`[e2e:prod] Suite: ${testPattern.join(' ')}`)
console.log(
  '[e2e:prod] Il guardrail (e2e/fixtures/guardrail.ts) è attivo: qualunque richiesta verso ' +
    'endpoint della blacklist distruttiva viene abortita e fa fallire il test.',
)

const env = {
  ...process.env,
  E2E_BASE_URL: PRODUCTION_BASE_URL,
  E2E_ALLOW_PROD_RUN: '1',
}

const configPath = path.join(__dirname, '..', 'playwright.config.ts')
const result = spawnSync(
  'npx',
  ['playwright', 'test', '-c', configPath, '--project=chromium', ...testPattern],
  { stdio: 'inherit', env, shell: true },
)

process.exit(result.status ?? 1)
