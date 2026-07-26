import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials } from '../../utils/env'
import { FirListPage } from '../../pages/fir-list.page'

/**
 * Ciclo di vita completo FIR: BOZZA -> EMESSO -> IN_TRANSITO -> CONSEGNATO
 * (UAT critico #2 dell'audit frontend — area con bug storici corretti in
 * 09d8fd5, priorità massima di re-test).
 *
 * Scheletro: ogni step è `test.fixme()` finché non saranno disponibili
 * credenziali di test E dati di fixture (un tenant/anagrafiche di test
 * dedicati, per non toccare mai dati reali). MAI test vuoti che passano
 * silenziosamente — fixme li marca esplicitamente come "da completare".
 */

test.describe('Ciclo di vita FIR completo', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test.fixme(
    'crea un nuovo FIR (con eventuale creazione anagrafica al volo)',
    async ({ page, context }) => {
      await loginAndSaveState(page, context, 'operator')
      const firList = new FirListPage(page)
      await firList.goto()
      await firList.openNuovoFirDialog()
      // TODO: compilare form creazione FIR (produttore/trasportatore/destinatario/CER/quantità)
      // e salvare — richiede dati di fixture stabili in ambiente di test.
    }
  )

  test.fixme('emette il FIR appena creato (BOZZA -> EMESSO)', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'operator')
    const firList = new FirListPage(page)
    await firList.goto()
    const row = firList.rowByText(/TODO-numero-fir/i)
    await firList.emetti(row)
    await expect(row).toContainText(/emesso/i)
  })

  test.fixme('presa in carico del FIR (EMESSO -> IN_TRANSITO)', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'operator')
    const firList = new FirListPage(page)
    await firList.goto()
    const row = firList.rowByText(/TODO-numero-fir/i)
    await firList.presaInCarico(row)
    await expect(row).toContainText(/transito/i)
  })

  test.fixme('conferma consegna (IN_TRANSITO -> CONSEGNATO)', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'operator')
    const firList = new FirListPage(page)
    await firList.goto()
    const row = firList.rowByText(/TODO-numero-fir/i)
    await firList.confermaConsegna(row)
    await expect(row).toContainText(/consegnato/i)
  })

  test.fixme('firma digitale del FIR consegnato', async () => {
    // Richiede SpidLevelGuard soddisfatto (livello SPID 2+) — da verificare
    // come viene simulato/soddisfatto in ambiente di test.
  })

  test.fixme('sync RENTRI del FIR (singolo e batch)', async () => {
    // Sync singolo (stato in lista/dettaglio, cronologia, azione manuale,
    // messaggio d'errore comprensibile) coperto da scenari REALI (non fixme)
    // in tests/fir/fir-rentri-status.spec.ts — cercano un FIR nello stato
    // che serve via API invece di richiedere una fixture nota in anticipo.
    // Resta fixme SOLO il batch: POST /rentri-sync/batch — richiede
    // credenziale RENTRI configurata sul tenant di test e più FIR pendenti
    // simultaneamente, non ancora coperto.
  })

  // NON testare mai: POST /fir/:id/annulla è in blacklist (irreversibile su
  // un documento legale) — il guardrail lo blocca comunque su produzione,
  // ma va esercitato SOLO su un tenant di test locale/staging dedicato, mai
  // qui in una spec generica potenzialmente eseguibile senza attenzione.
})
