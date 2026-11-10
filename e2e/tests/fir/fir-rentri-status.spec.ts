import { test, expect } from '@playwright/test'
import { currentTargetIsProduction } from '../../fixtures/auth'
import {
  accediUiComeAzienda,
  assicuraDbLocale,
  clientDbLocale,
  MOTIVO_DB_NON_LOCALE,
  saltaSeDbNonLocale,
  creaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { ATTESA_SERVER } from '../../utils/attese'
import {
  creaAnagrafiche,
  creaFirInStato,
  eliminaAnagrafiche,
  type AnagraficaCreata,
  type Anagrafiche,
} from '../../utils/fir-api'
import { FirListPage } from '../../pages/fir-list.page'
import { FirDetailPage } from '../../pages/fir-detail.page'

/**
 * Stato di sincronizzazione RENTRI in lista/dettaglio, cronologia e azione manuale (R1 Task 6).
 *
 * Fixture. Il database della CI parte vuoto, quindi gli scenari non cercano FIR preesistenti: lo
 * spec crea la PROPRIA azienda di test (admin / operator / viewer, piano PROFESSIONAL con il
 * modulo RENTRI) e i FIR che servono, via API. L'unico stato che l'API non produce senza l'ente,
 * un fallimento di trasmissione, si prepara scrivendo i campi di sync del FIR di prova (per id
 * esatto) sul database locale: e' la stessa fotografia che lascerebbe un tentativo fallito.
 *
 * RENTRI vero mai. L'azienda non ha credenziali RENTRI e il test non contatta l'ente: «Trasmetti»
 * accoda soltanto, e si asserisce il riscontro in interfaccia, non l'esito della trasmissione.
 * Gli scenari che richiedono davvero l'ente (certificato, accettazione, annullo, PDF) sono in
 * tests/rentri/, che usa la fake RENTRI.
 *
 * Pulizia. I FIR li toglie il teardown globale (registrati da `creaFirBozza`), le anagrafiche si
 * cancellano qui per id. L'azienda e i suoi utenti restano nel database di test.
 *
 * Gli scenari girano in serie: un nuovo accesso dello stesso utente invalida la sessione precedente.
 */

const db = clientDbLocale()

let azienda: AziendaDiTest
let tokenAdmin: string
let anagrafiche: Anagrafiche
const anagraficheCreate: AnagraficaCreata[] = []

test.describe('Stato RENTRI — lista, dettaglio, cronologia, azione manuale', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 })
  test.skip(saltaSeDbNonLocale(db), MOTIVO_DB_NON_LOCALE)

  test.beforeAll(async () => {
    assicuraDbLocale(db)
    azienda = await creaAziendaDiTest(db, 'stato RENTRI')
    // RENTRI e' un modulo a parte, non incluso nel piano PROFESSIONAL: si aggiunge a questa azienda.
    await db.tenant.update({
      where: { id: azienda.tenantId },
      data: { featureFlags: ['rentri'] },
    })
    tokenAdmin = await tokenAzienda(azienda, 'admin')
    anagrafiche = await creaAnagrafiche(tokenAdmin, anagraficheCreate)
  })

  test.afterAll(async () => {
    if (!db) return
    try {
      if (!azienda) return
      const errori = await eliminaAnagrafiche(
        await tokenAzienda(azienda, 'admin'),
        anagraficheCreate
      )
      expect(errori, 'pulizia delle anagrafiche create dallo spec').toEqual([])
    } finally {
      await db.$disconnect()
    }
  })

  test('lo stato di sincronizzazione RENTRI compare nella lista dei formulari', async ({
    page,
  }) => {
    const fir = await creaFirInStato(tokenAdmin, anagrafiche, 'EMESSO')
    await accediUiComeAzienda(page, azienda, 'operator')
    const firList = new FirListPage(page)
    await firList.goto()
    await firList.expectLoaded()

    // Il badge RENTRI compare solo per FIR non in BOZZA/ANNULLATO (FirListComponent.mostraStatoRentri).
    const badge = firList.rentriBadge(fir.numeroProgressivo!)
    await expect(badge).toBeVisible({ timeout: ATTESA_SERVER })
    // Stato iniziale dopo l'emissione: PENDING (verificato sul FIR creato) = «Da trasmettere».
    expect(fir.rentriSyncStatus).toBe('PENDING')
    await expect(badge).toContainText('Da trasmettere')
    // Una bozza non ha ancora nulla da trasmettere: nessun badge.
    const bozza = await creaFirInStato(tokenAdmin, anagrafiche, 'BOZZA')
    await page.reload()
    await expect(firList.rigaPerId(bozza.id)).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(
      firList.rigaPerId(bozza.id).locator('[data-testid^="rentri-sync-badge-"]')
    ).toHaveCount(0)
  })

  test('la pagina di dettaglio del formulario mostra la cronologia delle trasmissioni RENTRI', async ({
    page,
  }) => {
    const fir = await creaFirInStato(tokenAdmin, anagrafiche, 'EMESSO')
    await accediUiComeAzienda(page, azienda, 'operator')

    const detail = new FirDetailPage(page)
    await detail.goto(fir.id)
    await detail.expectLoaded()

    await expect(detail.numero).toBeVisible()
    await expect(detail.numero).toContainText(fir.numeroProgressivo!)
    // La cronologia (app-rentri-sync-logs) e' renderizzata per QUALUNQUE FIR, indipendentemente
    // dallo stato.
    await expect(detail.syncLogs).toBeVisible()
    // Caso reale: un tentativo fallito registrato per questo FIR (per id esatto; il log e' tolto
    // in cascata dal teardown globale insieme al FIR).
    const log = await db!.rENTRISyncLog.create({
      data: {
        firId: fir.id,
        tenantId: azienda.tenantId,
        status: 'FAILURE',
        attempt: 1,
        requestPayload: '{}',
        errorMessage: 'HTTP 403 Forbidden',
        errorCode: 'RENTRI_FORBIDDEN',
      },
    })
    await detail.syncLogsRefresh.click()
    const riga = detail.syncLogRow(log.id)
    await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(detail.syncLogsTable).toBeVisible()
    await expect(riga).toContainText('FAILURE')
    await expect(detail.syncLogsEmpty).toHaveCount(0)
  })

  test('la cronologia RENTRI senza log mostra il messaggio «Nessun log di sincronizzazione»', async ({
    page,
  }) => {
    // Regressione: GET /rentri/sync/logs rispondeva 400 (page/limit di query non convertiti in
    // numeri), la cronologia mostrava «Impossibile caricare i log» e il messaggio di stato vuoto
    // restava nascosto. Corretto con @Type(() => Number) in SyncLogsQueryDto.
    // Una BOZZA non trasmette nulla, quindi nessun log puo' comparire per effetto del sync.
    const fir = await creaFirInStato(tokenAdmin, anagrafiche, 'BOZZA')
    await accediUiComeAzienda(page, azienda, 'operator')
    const detail = new FirDetailPage(page)
    await detail.goto(fir.id)
    await detail.expectLoaded()
    await expect(detail.syncLogs).toBeVisible()
    await expect(detail.syncLogsEmpty).toBeVisible({ timeout: 5_000 })
  })

  test("l'azione manuale di trasmissione a RENTRI è disponibile per un FIR non ancora sincronizzato", async ({
    page,
  }) => {
    test.skip(
      currentTargetIsProduction(),
      "Trasmettere a RENTRI ha un effetto reale sul FIR e sull'ente esterno: mai contro produzione."
    )
    const fir = await creaFirInStato(tokenAdmin, anagrafiche, 'EMESSO')
    expect(fir.rentriSyncStatus).toBe('PENDING')
    await accediUiComeAzienda(page, azienda, 'operator')

    const detail = new FirDetailPage(page)
    await detail.goto(fir.id)
    await detail.expectLoaded()

    await expect(detail.rentriTrasmetti).toBeVisible()
    await detail.rentriTrasmetti.click()

    // Il click accoda la trasmissione: non si asserisce l'esito finale (l'azienda non ha credenziali
    // RENTRI e l'ente non viene contattato), solo il riscontro in interfaccia (toast di
    // accodamento, v. FirDetailComponent.trasmettiRENTRI).
    await expect(page.getByText(/trasmissione avviata/i)).toBeVisible({ timeout: 10_000 })
  })

  test("il messaggio d'errore RENTRI mostrato è comprensibile, non un codice tecnico", async ({
    page,
  }) => {
    const fir = await creaFirInStato(tokenAdmin, anagrafiche, 'EMESSO')
    // Fotografia di un tentativo fallito (HTTP 403 dell'ente), scritta per id esatto sul FIR di prova.
    // Race: l'emissione puo' avere accodato un job di sync automatico che, se parte dopo la
    // scrittura, riporta lo stato a SYNCING/FAILED con altro errore (l'azienda non ha credenziali).
    // Non si puo' disattivare il worker dal test (gira nel backend, gia' avviato), quindi si rende
    // l'asserzione convergente: a ogni giro si riscrive la fotografia, si ricarica la pagina e si
    // attende il messaggio; passa solo quando la pagina mostra davvero lo stato scritto.
    const scriviFallito = () =>
      db!.fIR.update({
        where: { id: fir.id },
        data: {
          rentriSyncStatus: 'FAILED',
          rentriSyncAttempts: 1,
          rentriLastSyncError: 'HTTP 403 Forbidden',
          rentriLastSyncErrorCode: 'RENTRI_FORBIDDEN',
        },
      })
    await accediUiComeAzienda(page, azienda, 'operator')

    const detail = new FirDetailPage(page)
    await expect(async () => {
      await scriviFallito()
      await detail.goto(fir.id)
      await detail.expectLoaded()
      await expect(detail.rentriMessaggioErrore).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: ATTESA_SERVER })
    // Stato del badge: FAILED al primo tentativo = «Riprova 1/5».
    await expect(detail.rentriBadge(fir.numeroProgressivo!)).toContainText('Riprova 1/5')
    const testo = (await detail.rentriMessaggioErrore.innerText()).trim()

    // "Comprensibile" = non un codice/enum tecnico: niente SCREAMING_SNAKE_CASE puro, contiene
    // spazi (una frase), e' abbastanza lungo da dire qualcosa, non riporta il 403 grezzo.
    expect(testo.length).toBeGreaterThan(15)
    expect(testo).toMatch(/\s/)
    expect(testo).not.toMatch(/^[A-Z0-9_]+$/)
    expect(testo).not.toMatch(/RENTRI_[A-Z_]+/)
    expect(testo).not.toMatch(/403/)
  })
})
