/**
 * Verifica di residuo zero (Task 1 del piano UAT/E2E) + teardown globale.
 *
 * Due responsabilità distinte, tenute volutamente separate:
 *
 * - `verificaResiduo(token)`: interroga le liste di produttori/trasportatori/
 *   destinatari (via API) E i FIR (via database — vedi utils/db-locale.ts,
 *   nessun endpoint HTTP li espone tutti) e riporta ogni record il cui
 *   snapshot porta il prefisso della run corrente (vedi utils/run-id.ts
 *   `haPrefissoDiRun`). È la verifica INDIPENDENTE dal registro in
 *   memoria/su file di fixtures/risorse.ts: non si fida che `ripulisci()`
 *   abbia tracciato tutto correttamente, guarda i dati reali rimasti.
 *   Include i FIR non per completismo: un residuo che la verifica non
 *   guarda non è un residuo zero, è una rassicurazione (rilievo 1 del giro
 *   di correzione 1, 2026-09-14).
 *
 * - `export default` (globalTeardown di playwright.config.ts): orchestratore
 *   end-to-end per l'intera run — login, `ripulisci()` (teardown vero e
 *   proprio delle risorse registrate), poi `verificaResiduo` come controllo
 *   finale. Se resta anche un solo record col prefisso della run, la run
 *   FALLISCE (throw): un residuo non è un warning, è un difetto della
 *   pulizia.
 *
 * Idempotente: se non ci sono credenziali configurate (ambiente senza
 * backend/E2E_ADMIN_USER-PASS) o niente è stato registrato, non fa nulla e
 * non fallisce — deve poter girare anche dopo una run morta a metà, prima
 * ancora che qualunque risorsa sia stata creata. Una volta che il teardown
 * PARTE per davvero (credenziali presenti), la verifica sui FIR richiede
 * DATABASE_URL a un host locale — vedi utils/db-locale.ts — e fallisce
 * esplicitamente se manca, invece di saltare in silenzio quella parte.
 */

import type { FullConfig } from '@playwright/test'
import { apiGet, apiLogin } from '../utils/api-client'
import { chiudiConnessioneDb, firConPrefissoResidui } from '../utils/db-locale'
import { getRoleCredentials, isProductionTarget } from '../utils/env'
import { haPrefissoDiRun } from '../utils/run-id'
import { ripulisci } from '../fixtures/risorse'

interface VoceRegistry {
  id: string
  ragioneSociale: string
}

interface ListaPaginata<T> {
  items: T[]
}

const ENDPOINT_PER_TIPO: Record<string, string> = {
  produttore: '/registry/produttori',
  trasportatore: '/registry/trasportatori',
  destinatario: '/registry/destinatari',
}

/**
 * Cerca, in ogni endpoint di anagrafica PIÙ nei FIR (a livello di
 * database), record il cui nome/snapshot porta il prefisso della run
 * corrente. Ritorna la lista dei residui trovati (vuota se non ce n'è
 * nessuno) nel formato `tipo:id:ragioneSociale` (anagrafiche) o `fir:id`.
 */
export async function verificaResiduo(token: string): Promise<string[]> {
  const residui: string[] = []

  for (const [tipo, endpoint] of Object.entries(ENDPOINT_PER_TIPO)) {
    const lista = await apiGet<ListaPaginata<VoceRegistry>>(endpoint, token)
    for (const voce of lista.items) {
      if (haPrefissoDiRun(voce.ragioneSociale)) {
        residui.push(`${tipo}:${voce.id}:${voce.ragioneSociale}`)
      }
    }
  }

  residui.push(...(await firConPrefissoResidui()))

  return residui
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

  const credenziali = getRoleCredentials('admin')
  if (!credenziali) {
    // eslint-disable-next-line no-console
    console.warn(
      '[verifica-residuo] Credenziali mancanti per il ruolo "admin" (E2E_ADMIN_USER/PASS): ' +
        'teardown e verifica di residuo saltati. Se la run ha creato dati via API con un altro ' +
        'ruolo, quei dati NON vengono ripuliti — servono le credenziali admin per il login dev.'
    )
    return
  }

  const token = await apiLogin('admin')

  try {
    const { rimosse, residue: residuiNonCancellabili } = await ripulisci(token)
    // eslint-disable-next-line no-console
    console.log(`[verifica-residuo] Teardown: ${rimosse} risorse rimosse.`)

    const residuoTrovato = await verificaResiduo(token)

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
