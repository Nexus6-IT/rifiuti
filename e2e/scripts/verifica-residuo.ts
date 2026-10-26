/**
 * Verifica di residuo zero (Task 1 del piano UAT/E2E) + teardown globale.
 *
 * Due responsabilità distinte, tenute volutamente separate:
 *
 * - `verificaResiduo()`: interroga produttori/trasportatori/destinatari E i
 *   FIR, ENTRAMBI via database (vedi utils/db-locale.ts), e riporta ogni
 *   record il cui snapshot porta il prefisso della run corrente (vedi
 *   utils/run-id.ts `haPrefissoDiRun`). È la verifica INDIPENDENTE dal
 *   registro in memoria/su file di fixtures/risorse.ts: non si fida che
 *   `ripulisci()` abbia tracciato tutto correttamente, guarda i dati reali
 *   rimasti — per DAVVERO, non solo quelli visibili dal tenant primario
 *   dell'admin.
 *   Include i FIR non per completismo: un residuo che la verifica non
 *   guarda non è un residuo zero, è una rassicurazione (rilievo 1 del giro
 *   di correzione 1, 2026-09-14).
 *   Le anagrafiche sono passate da `GET /registry/*` (via API, tenant
 *   dell'admin) al database diretto (rilievo della revisione finale,
 *   2026-09-14): quell'endpoint scopa sempre sul tenant PRIMARIO
 *   dell'utente autenticato, quindi un residuo lasciato in un secondo
 *   tenant (es. dal test di isolamento fra aziende,
 *   tests/registry/produttore.spec.ts) sarebbe sfuggito in silenzio —
 *   esattamente il tipo di rassicurazione che il modulo diceva di non
 *   voler essere. Vedi utils/db-locale.ts `anagraficheConPrefissoResidui`.
 *
 * - `export default` (globalTeardown di playwright.config.ts): orchestratore
 *   end-to-end per l'intera run — login, `ripulisci()` (teardown vero e
 *   proprio delle risorse registrate), poi `verificaResiduo` come controllo
 *   finale. Se resta anche un solo record col prefisso della run, la run
 *   FALLISCE (throw): un residuo non è un warning, è un difetto della
 *   pulizia.
 *
 * Regola (vedi utils/decisione-teardown.ts):
 * - nulla registrato e DATABASE_URL NON impostata: non fa nulla e non fallisce;
 * - nulla registrato ma DATABASE_URL impostata (es. passata 1 della CI): niente
 *   login né pulizia, ma `verificaResiduo()` (sola query DB) gira comunque e la
 *   run fallisce se trova record col prefisso della run;
 * - qualcosa registrato e admin autenticabile: login, pulizia e verifica;
 * - qualcosa registrato ma admin NON autenticabile: errore esplicito (i dati
 *   creati resterebbero).
 * Una volta che la verifica parte, richiede DATABASE_URL a un host locale — vedi
 * utils/db-locale.ts — e fallisce esplicitamente se manca, invece di saltare
 * in silenzio quella parte.
 */

import type { FullConfig } from '@playwright/test'
import { apiLogin } from '../utils/api-client'
import {
  anagraficheConPrefissoResidui,
  chiudiConnessioneDb,
  firConPrefissoResidui,
} from '../utils/db-locale'
import { decidiTeardown } from '../utils/decisione-teardown'
import { hasRoleCredentials, isProductionTarget } from '../utils/env'
import { contaRisorseRegistrate, ripulisci } from '../fixtures/risorse'

/**
 * Cerca, nel database, anagrafiche (di TUTTI i tenant) E FIR il cui
 * nome/snapshot porta il prefisso della run corrente. Ritorna la lista dei
 * residui trovati (vuota se non ce n'è nessuno) nel formato
 * `tipo:id:ragioneSociale` (anagrafiche) o `fir:id`.
 */
export async function verificaResiduo(): Promise<string[]> {
  return [...(await anagraficheConPrefissoResidui()), ...(await firConPrefissoResidui())]
}

/**
 * Teardown globale registrato in playwright.config.ts. Fa login con il
 * ruolo "admin" (l'unico servito da tutti e tre gli endpoint di
 * cancellazione — vedi @Roles su registry.controller.ts), ripulisce le
 * risorse registrate durante la run e verifica che non ne resti traccia.
 */
export default async function globalTeardown(_config: FullConfig): Promise<void> {
  if (isProductionTarget()) {
    // Non dovrebbe mai succedere: playwright.config.ts blocca già l'avvio
    // contro produzione senza E2E_ALLOW_PROD_RUN=1. Difesa in profondità:
    // se qualcuno bypassa quel controllo, il teardown non tenta comunque
    // cancellazioni non tracciate contro un ambiente reale.
    // eslint-disable-next-line no-console
    console.warn(
      '[verifica-residuo] Target di produzione: teardown eseguito con la massima cautela — ' +
        'solo le risorse esplicitamente registrate in questa run verranno cancellate.'
    )
  }

  const decisione = decidiTeardown({
    registrate: contaRisorseRegistrate(),
    adminAutenticabile: hasRoleCredentials('admin'),
    databaseDisponibile: Boolean(process.env.DATABASE_URL?.trim()),
  })
  if (decisione === 'niente') return
  if (decisione === 'solo-verifica') {
    try {
      const residuo = await verificaResiduo()
      if (residuo.length > 0) {
        throw new Error(
          `[verifica-residuo] Residuo non zero: ${residuo.length} record col prefisso della run ` +
            `(nulla era stato registrato, ma il database ne contiene):\n${residuo.join('\n')}`
        )
      }
    } finally {
      await chiudiConnessioneDb()
    }
    return
  }
  if (decisione === 'errore') {
    throw new Error(
      '[verifica-residuo] In questa run sono state registrate risorse da ripulire, ma il ruolo ' +
        '"admin" non è autenticabile (né E2E_ADMIN_USER/PASS né dev-login su un target locale): ' +
        'i dati creati resterebbero e la verifica di residuo zero non può girare.'
    )
  }

  const token = await apiLogin('admin')

  try {
    const { rimosse, residue: residuiNonCancellabili } = await ripulisci(token)
    // eslint-disable-next-line no-console
    console.log(`[verifica-residuo] Teardown: ${rimosse} risorse rimosse.`)

    const residuoTrovato = await verificaResiduo()

    const tuttiIResidui = [...residuiNonCancellabili, ...residuoTrovato]
    if (tuttiIResidui.length > 0) {
      throw new Error(
        `[verifica-residuo] Residuo non zero dopo il teardown: ${tuttiIResidui.length} record col ` +
          `prefisso della run non sono stati rimossi:\n${tuttiIResidui.join('\n')}`
      )
    }
  } finally {
    // Chiude la connessione Postgres aperta da utils/db-locale.ts (se
    // aperta): il processo di globalTeardown deve poter terminare senza
    // restare appeso su un handle di connessione dimenticato.
    await chiudiConnessioneDb()
  }
}
