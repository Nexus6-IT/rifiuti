import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason, currentTargetIsProduction } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { FirDetailPage } from '../../pages/fir-detail.page'

/**
 * R3 Task 10 — ciclo di vita del formulario RENTRI: accettazione/
 * respingimento (anche parziale) del carico, annullamento con nota,
 * gestione allegati, stampa PDF, e la controparte E2E della difesa
 * "un'operazione non disponibile non mostra il pulsante" (già coperta lato
 * unitario dai test frontend del Task 8).
 *
 * Un solo file per tutti gli scenari del ciclo (non uno per operazione):
 * condividono la stessa premessa (un FIR legato a RENTRI, ruolo operator) e
 * lo stesso schema di ricerca-dello-stato-via-API, a differenza di
 * `rentri-aggancio-formulari.spec.ts` (dominio concettualmente diverso:
 * "cercare→agganciare" contro "un formulario già agganciato").
 *
 * Stessa convenzione di `rentri-aggancio-formulari.spec.ts` e
 * `fir-rentri-status.spec.ts`: `test.skip()` a livello di `describe` sulle
 * credenziali (E2E_OPERATOR_USER/PASS non impostate in QUESTO ambiente — v.
 * e2e/README.md, "Cosa manca": ogni scenario va in skip qui, è l'esito
 * atteso), e `test.skip()` A RUNTIME quando lo stato specifico richiesto
 * (es. un FIR nella fase di accettazione) non è disponibile nel tenant di
 * test — mai un dato inventato, mai un test vuoto che passa in silenzio.
 *
 * Scritture reali contro RENTRI (accetta, respingi, annulla, carica/elimina
 * allegato): mai contro produzione, stesso criterio di
 * `fir-rentri-status.spec.ts` ("l'azione manuale... non contro produzione").
 */

interface FIRSummary {
  id: string
  numeroProgressivo?: string | null
  stato: string
  rentriNumeroFir?: string | null
}

interface AzioneRentri {
  operazione: string
  verbo: string
}

async function getAccessToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('accessToken'))
  if (!token) {
    throw new Error(
      'accessToken assente in localStorage dopo il login: verificare AuthService.setSession() ' +
        '(chiave "accessToken") o se il flusso di login è cambiato.'
    )
  }
  return token
}

async function listFirs(page: import('@playwright/test').Page, limit = 100): Promise<FIRSummary[]> {
  const token = await getAccessToken(page)
  const response = await page.request.get(`${getApiUrl()}/fir?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok(), `GET /fir ha risposto ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return (body.items ?? []) as FIRSummary[]
}

/** Azioni RENTRI disponibili ORA sul FIR indicato (stesso endpoint del "motore della UI", R3 Task 2). */
async function getAzioniDisponibili(
  page: import('@playwright/test').Page,
  firId: string
): Promise<{ stato: string; azioni: AzioneRentri[] } | null> {
  const token = await getAccessToken(page)
  const response = await page.request.get(`${getApiUrl()}/rentri/fir/${firId}/azioni`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok()) {
    return null
  }
  return response.json()
}

/**
 * Trova, fra i FIR legati a RENTRI del tenant, il primo il cui `/azioni`
 * contiene `operazione` (o non la contiene, se `deveContenerla` è `false`).
 * Nessun dato inventato: interroga davvero l'API con lo stesso token della
 * sessione, come richiesto dal brief per scenari che dipendono da uno stato
 * specifico del formulario non prevedibile in anticipo.
 */
async function trovaFirConAzione(
  page: import('@playwright/test').Page,
  operazione: string,
  deveContenerla: boolean
): Promise<FIRSummary | null> {
  const firs = await listFirs(page)
  const legati = firs.filter(f => !!f.rentriNumeroFir)

  for (const fir of legati) {
    const risultato = await getAzioniDisponibili(page, fir.id)
    if (!risultato) continue
    const ha = risultato.azioni.some(a => a.operazione === operazione)
    if (ha === deveContenerla) {
      return fir
    }
  }
  return null
}

test.describe('RENTRI — ciclo di vita del formulario (accettazione, annullamento, allegati, PDF)', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test('accetta un carico per intero', async ({ page, context }) => {
    test.skip(
      currentTargetIsProduction(),
      "Accettare un carico ha un effetto reale e irreversibile sul formulario presso l'ente: mai contro produzione."
    )
    await loginAndSaveState(page, context, 'operator')

    const firAccettabile = await trovaFirConAzione(page, 'Accettazione', true)
    test.skip(
      !firAccettabile,
      "Nessun FIR legato a RENTRI con 'Accettazione' fra le azioni disponibili ORA (serve un formulario " +
        'nella fase di accettazione presso la fake/l’ente): nessuna fixture nota in anticipo per prepararlo in questo ambiente.'
    )

    const detail = new FirDetailPage(page)
    await detail.goto(firAccettabile!.id)
    await detail.expectLoaded()

    await expect(detail.rentriAccettaCarico).toBeVisible()
    await detail.rentriAccettaCarico.click()
    await expect(detail.rentriAccettazioneDialog).toBeVisible()

    await detail.rentriAccettazioneCompleta.click()
    await detail.rentriAccettazioneQuantitaInput.locator('input').fill('100')
    await detail.rentriAccettazioneConfirmButton.click()

    await expect(detail.rentriAccettazioneDialog).toBeHidden()
    await expect(page.getByText(/carico accettato/i)).toBeVisible({ timeout: 15_000 })
  })

  test('respingi parzialmente il carico con motivazione', async ({ page, context }) => {
    test.skip(
      currentTargetIsProduction(),
      "Respingere (anche parzialmente) un carico ha un effetto reale sul formulario presso l'ente: mai contro produzione."
    )
    await loginAndSaveState(page, context, 'operator')

    const firAccettabile = await trovaFirConAzione(page, 'Accettazione', true)
    test.skip(
      !firAccettabile,
      "Nessun FIR legato a RENTRI con 'Accettazione' fra le azioni disponibili ORA: nessuna fixture nota " +
        'in anticipo per prepararne uno in questo ambiente.'
    )

    const detail = new FirDetailPage(page)
    await detail.goto(firAccettabile!.id)
    await detail.expectLoaded()

    await expect(detail.rentriAccettaCarico).toBeVisible()
    await detail.rentriAccettaCarico.click()
    await expect(detail.rentriAccettazioneDialog).toBeVisible()

    await detail.rentriAccettazioneParziale.click()
    await detail.rentriAccettazioneQuantitaInput.locator('input').fill('40')
    await detail.rentriAccettazioneCausaleSelect.click()
    const causaleOpzione = page.locator('.p-dropdown-item').first()
    await expect(causaleOpzione).toBeVisible()
    await causaleOpzione.click()
    await detail.rentriAccettazioneMotivoInput.fill(
      'Parte del carico presenta caratteristiche non conformi al FIR: respinta la quota eccedente.'
    )

    await expect(detail.rentriAccettazioneConfirmButton).toBeEnabled()
    await detail.rentriAccettazioneConfirmButton.click()

    await expect(detail.rentriAccettazioneDialog).toBeHidden()
    await expect(page.getByText(/carico accettato/i)).toBeVisible({ timeout: 15_000 })
  })

  test('annulla un formulario con nota', async ({ page, context }) => {
    test.skip(
      currentTargetIsProduction(),
      "L'annullamento è irreversibile presso RENTRI (v. avviso nel dialog stesso): mai contro produzione."
    )
    await loginAndSaveState(page, context, 'operator')

    const firAnnullabile = await trovaFirConAzione(page, 'Annulla', true)
    test.skip(
      !firAnnullabile,
      "Nessun FIR legato a RENTRI con 'Annulla' fra le azioni disponibili ORA: nessuna fixture nota in " +
        'anticipo per prepararne uno in questo ambiente.'
    )

    const detail = new FirDetailPage(page)
    await detail.goto(firAnnullabile!.id)
    await detail.expectLoaded()

    await expect(detail.rentriAnnullaFormulario).toBeVisible()
    await detail.rentriAnnullaFormulario.click()
    await expect(detail.rentriAnnullaDialog).toBeVisible()

    const motivo = `Errore di battitura sulla quantità: annullo il formulario (test E2E ${Date.now()}).`
    await detail.rentriAnnullaMotivoInput.fill(motivo)
    await expect(detail.rentriAnnullaConfirmButton).toBeEnabled()
    await detail.rentriAnnullaConfirmButton.click()

    await expect(detail.rentriAnnullaDialog).toBeHidden()
    await expect(page.getByText(/formulario annullato/i)).toBeVisible({ timeout: 15_000 })

    // --- Verifica "compaia nella cronologia": NON verificabile in UI ---
    //
    // Letto `fir-detail.component.ts` PRIMA di scrivere questa asserzione
    // (come richiesto dal brief): l'unica sezione che il template chiama
    // "cronologia" è <app-rentri-sync-logs> (`data-testid="rentri-sync-logs"`,
    // v. FirDetailPage.syncLogs), che elenca i TENTATIVI DI TRASMISSIONE
    // (RENTRISyncLog: stato/esito/timestamp di ogni chiamata verso RENTRI),
    // non il testo libero della nota di annullamento. Nessun punto del
    // template rende `annullamentoMotivo`/il campo persistito visibile
    // all'utente dopo l'invio: non esiste un "annulla-motivo-display" o
    // simile. Un'asserzione come "il pulsante Annulla è sparito" non
    // proverebbe che LA NOTA sia visibile (potrebbe essere sparito solo
    // perché lo stato è cambiato) — il brief vieta esplicitamente questa
    // scorciatoia.
    //
    // Fallback previsto dal brief: verifica via API che il motivo sia stato
    // PERSISTITO. Campo Prisma verificato nel codice (non ipotizzato):
    // `motivoAnnullamento` (schema.prisma riga ~314, mappato
    // `motivo_annullamento`; dominio `FIR.motivoAnnullamento`,
    // `fir.aggregate.ts` riga 1129; scritto da `annullaConData`/
    // `applyRentriAnnullamentoConfermato`, letto anche da
    // `rentri-annullamento.oracolo.spec.ts`). PROBLEMA ulteriore, più a
    // monte di quanto il brief anticipasse: `FIRResponseDto.fromDomain`
    // (`apps/backend/src/api/fir/dtos/fir-response.dto.ts`) NON espone
    // `motivoAnnullamento` nel corpo di `GET /fir/:id` — il campo è
    // persistito lato dominio/database ma non raggiungibile da NESSUNA API
    // oggi. La verifica end-to-end di "il motivo è stato salvato" non è
    // quindi eseguibile con gli endpoint REST esistenti, senza estendere il
    // DTO (fuori scope di questo task — non lo si fa qui silenziosamente).
    //
    // Si dichiara esplicitamente la limitazione (mai un'asserzione debole):
    // il salvataggio del motivo resta verificato SOLO dal test unitario/
    // oracolo esistente (v. i tre asserts su `motivoAnnullamento` in
    // `rentri-annullamento.oracolo.spec.ts`, righe 415/534/586), non da
    // questo scenario E2E.
    test.info().annotations.push({
      type: 'limite-noto',
      description:
        "Il motivo dell'annullamento (campo Prisma motivoAnnullamento) non è esposto da GET /fir/:id " +
        '(FIRResponseDto non lo include): questo scenario verifica solo il flusso UI (toast di conferma), ' +
        'non la persistenza del testo della nota, coperta invece da rentri-annullamento.oracolo.spec.ts.',
    })
  })

  test('carica e cancella un allegato', async ({ page, context }) => {
    test.skip(
      currentTargetIsProduction(),
      "Caricare/eliminare un allegato ha un effetto reale sul formulario presso l'ente: mai contro produzione."
    )
    await loginAndSaveState(page, context, 'operator')

    const firs = await listFirs(page)
    const firConLegame = firs.find(f => !!f.rentriNumeroFir)
    test.skip(
      !firConLegame,
      'Nessun FIR legato a RENTRI nel tenant di test: nessuna fixture nota in anticipo per prepararne uno.'
    )

    const detail = new FirDetailPage(page)
    await detail.goto(firConLegame!.id)
    await detail.expectLoaded()

    const sezioneAllegatiVisibile = await detail.allegatiUploadInput.isVisible().catch(() => false)
    test.skip(
      !sezioneAllegatiVisibile,
      'La sezione allegati non è mostrata per questo FIR (v. FirDetailComponent.canGestireAllegati): ' +
        'ruolo insufficiente o legame RENTRI non ancora confermato in questo giro.'
    )

    // PDF minimo valido: solo l'header/trailer necessari a passare la
    // verifica di formato (Content-Type + primi byte), un file reale non
    // serve per lo scenario di caricamento/cancellazione.
    const contenutoPdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'utf-8')
    await detail.allegatiUploadInput.setInputFiles({
      name: `test-e2e-${Date.now()}.pdf`,
      mimeType: 'application/pdf',
      buffer: contenutoPdf,
    })

    // Il caricamento è asincrono (chiamata a RENTRI): attende che una nuova
    // riga compaia nell'elenco locale, senza assumere quale sarà il suo id
    // (assegnato dal backend).
    const righeAllegati = detail.allegatiList.locator('li.allegati-row')
    const numeroRigheIniziale = await righeAllegati.count()
    await expect(righeAllegati).toHaveCount(numeroRigheIniziale + 1, { timeout: 20_000 })

    const nuovaRiga = righeAllegati.last()
    const testIdRiga = await nuovaRiga.getAttribute('data-testid')
    const allegatoId = testIdRiga!.replace('fir-detail-allegati-row-', '')

    await detail.allegatoEliminaButton(allegatoId).click()
    await expect(detail.allegatoRow(allegatoId)).toBeHidden({ timeout: 20_000 })
  })

  test('scarica il PDF del formulario', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'operator')

    const firs = await listFirs(page)
    const firConLegame = firs.find(f => !!f.rentriNumeroFir)
    test.skip(
      !firConLegame,
      'Nessun FIR legato a RENTRI nel tenant di test: nessuna fixture nota in anticipo per prepararne uno.'
    )

    const detail = new FirDetailPage(page)
    await detail.goto(firConLegame!.id)
    await detail.expectLoaded()

    const pulsanteVisibile = await detail.rentriScaricaPdf.isVisible().catch(() => false)
    test.skip(
      !pulsanteVisibile,
      "Il pulsante 'Scarica il PDF' non è mostrato per questo FIR (v. FirDetailComponent.canScaricarePdfRentri): " +
        'ruolo insufficiente in questo giro.'
    )

    // Il backend fa da TRAMITE (stream, mai un redirect al portale RENTRI —
    // v. commento di classe di RentriFirLifecycleController.scaricaPdf):
    // la prova che conta è che il download avvenga DENTRO l'app, senza
    // navigare altrove. Playwright intercetta l'evento 'download' solo se
    // il browser tratta la risposta come tale; qui il frontend gestisce il
    // Blob via HttpClient e apre/scarica lato client (v.
    // FirDetailComponent.scaricaPdfRentri) — verifichiamo quindi la
    // richiesta di rete effettiva, non un evento 'download' del browser.
    const rispostaAttesa = page.waitForResponse(
      resp =>
        resp.url().includes(`/rentri/fir/${firConLegame!.id}/pdf`) &&
        resp.request().method() === 'GET'
    )
    await detail.rentriScaricaPdf.click()
    const risposta = await rispostaAttesa

    // 204 (nessun PDF ancora disponibile presso l'ente) è un esito legittimo
    // dichiarato dal contratto, non un errore: in quel caso l'app mostra un
    // messaggio informativo invece del download, e lo scenario si ferma qui
    // senza fallire (nessun PDF reale da scaricare in questo giro).
    if (risposta.status() === 204) {
      await expect(page.getByText(/pdf non ancora disponibile/i)).toBeVisible({ timeout: 10_000 })
      return
    }

    expect(risposta.ok(), `GET .../pdf ha risposto ${risposta.status()}`).toBeTruthy()
    const contentType = risposta.headers()['content-type']
    expect(contentType).toContain('application/pdf')
  })

  test("un'azione non disponibile non mostra il pulsante corrispondente", async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')

    const firSenzaAccettazione = await trovaFirConAzione(page, 'Accettazione', false)
    test.skip(
      !firSenzaAccettazione,
      "Nessun FIR legato a RENTRI il cui /azioni ESCLUDA 'Accettazione' nel tenant di test (servirebbe un " +
        'formulario fuori dalla fase di accettazione, es. già Accettato/Annullato): nessuna fixture nota in ' +
        'anticipo per prepararlo in questo ambiente.'
    )

    const detail = new FirDetailPage(page)
    await detail.goto(firSenzaAccettazione!.id)
    await detail.expectLoaded()

    // Controparte E2E del test unitario del Task 8
    // (FirDetailComponent.canAccettareCarico, gia' coperto lato frontend):
    // qui verifichiamo che il DOM reale, dietro il login e la chiamata
    // reale a /azioni, non renda il pulsante — non solo che il metodo
    // TypeScript ritorni false in isolamento.
    await expect(detail.rentriAccettaCarico).toHaveCount(0)
  })
})

/**
 * Regressione — trovata dal revisore (2026-09-14): `rentriAccettazioneConfirmButton`/
 * `rentriAnnullaConfirmButton` avevano `data-testid` sull'host `<p-button>`
 * (v. `fir-detail.component.ts:606-612` e `:654-660`, `[disabled]="!…Valida()"`
 * applicato da PrimeNG solo al `<button>` nativo interno). Le righe 171 e
 * 202 di questo file facevano `toBeEnabled()` su quei locator: su un host
 * non nativo quell'asserzione è sempre vera, proprio nel punto in cui
 * verificano che il bottone si sblocchi dopo aver compilato il form — due
 * righe sopra lo stesso file usa già `.locator('input')` per lo stesso
 * motivo su un altro campo, quindi la correzione era nota a chi l'ha
 * scritto. Corretto scendendo al `<button>` nativo in `fir-detail.page.ts`
 * (stessa scelta di `rentri-blocchi.page.ts` per `vidimaConferma`).
 *
 * DOM statico via `page.setContent`, nessuna app viva: riproduce lo stesso
 * host/bottone di `fir-detail.component.ts` e prova che l'host non riflette
 * MAI `disabled` mentre il bottone nativo lo fa.
 */
test.describe('RENTRI ciclo formulario — regressione: toBeEnabled su host p-button non è mai attendibile', () => {
  test('host p-button con bottone nativo disabled: toBeEnabled() sull’host mente, sul nativo è corretto', async ({
    page,
  }) => {
    await page.setContent(`
      <div data-testid="fir-detail-rentri-accettazione-confirm-button">
        <button type="button" disabled>Conferma</button>
      </div>
    `)

    // Prova diretta della trappola: l'host non è un vero form control,
    // Playwright lo considera sempre "enabled" a prescindere dal bottone
    // nativo al suo interno.
    await expect(page.getByTestId('fir-detail-rentri-accettazione-confirm-button')).toBeEnabled()

    // Il locator corretto, scoped al bottone nativo (come ora in
    // `fir-detail.page.ts`), riconosce davvero lo stato disabilitato.
    await expect(
      page.getByTestId('fir-detail-rentri-accettazione-confirm-button').locator('button')
    ).toBeDisabled()
  })
})
