import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason, currentTargetIsProduction } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { FirListPage } from '../../pages/fir-list.page'
import { FirDetailPage } from '../../pages/fir-detail.page'

/**
 * Stato di sincronizzazione RENTRI in lista/dettaglio, cronologia e azione
 * manuale (R1 Task 6 — verifica end-to-end della fase R1).
 *
 * Scheletro nella stessa convenzione di tests/fir/fir-lifecycle.spec.ts:
 * `test.skip()` condizionale sulle credenziali (E2E_OPERATOR_USER/PASS),
 * MAI un test vuoto che passa silenziosamente. A differenza di
 * fir-lifecycle.spec.ts (che usa `test.fixme()` perché mancano ANCHE i dati
 * di fixture, non solo le credenziali), qui i corpi sono asserzioni reali:
 * non serve un FIR specifico noto in anticipo, i test cercano nella lista
 * un FIR nello stato che serve tramite l'API (stesso token della sessione
 * loggata) e saltano esplicitamente — con `test.skip()` a runtime, non un
 * `pass` silenzioso — se l'ambiente non ha ancora un FIR in quello stato.
 *
 * Navigazione al dettaglio: `fir-list.component.ts` non espone (ancora) un
 * link/routerLink verso `/fir/:id` (v. nota in FirDetailPage) — la pagina si
 * raggiunge per URL diretto, con l'id ottenuto dalla stessa chiamata API
 * usata per trovare il FIR nello stato cercato.
 */

interface FIRSummary {
  id: string
  numeroProgressivo?: string | null
  stato: string
  rentriSyncStatus?: string | null
  rentriNumeroFir?: string | null
  rentriNumeroFirProposto?: string | null
  rentriMessaggioErrore?: string | null
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

/** Recupera fino a `limit` FIR del tenant loggato, per cercare uno stato specifico senza fixture note in anticipo. */
async function listFirs(page: import('@playwright/test').Page, limit = 50): Promise<FIRSummary[]> {
  const token = await getAccessToken(page)
  const response = await page.request.get(`${getApiUrl()}/fir?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok(), `GET /fir ha risposto ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return (body.items ?? []) as FIRSummary[]
}

test.describe('Stato RENTRI — lista, dettaglio, cronologia, azione manuale', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test('lo stato di sincronizzazione RENTRI compare nella lista dei formulari', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')

    const firs = await listFirs(page)
    // Il badge RENTRI compare solo per FIR non in BOZZA/ANNULLATO (v.
    // FirListComponent.mostraStatoRentri, riusata identica in dettaglio).
    const conBadge = firs.find(f => f.stato !== 'BOZZA' && f.stato !== 'ANNULLATO')
    test.skip(
      !conBadge,
      'Nessun FIR in uno stato che mostra il badge RENTRI (serve almeno un FIR EMESSO/IN_TRANSITO/CONSEGNATO) — ambiente senza dati di fixture per questo scenario.'
    )

    const firList = new FirListPage(page)
    await firList.goto()
    await firList.expectLoaded()

    const numeroFir = conBadge!.numeroProgressivo || conBadge!.id
    await expect(firList.rentriBadge(numeroFir)).toBeVisible()
  })

  test('la pagina di dettaglio del formulario mostra la cronologia delle trasmissioni RENTRI', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')

    const firs = await listFirs(page)
    test.skip(firs.length === 0, 'Nessun FIR disponibile per il tenant di test.')

    const detail = new FirDetailPage(page)
    await detail.goto(firs[0].id)
    await detail.expectLoaded()

    await expect(detail.numero).toBeVisible()
    // La cronologia (app-rentri-sync-logs) è renderizzata per QUALUNQUE FIR,
    // indipendentemente dallo stato — v. fir-detail.component.ts, sezione
    // finale fuori da ogni @if di stato.
    await expect(detail.syncLogs).toBeVisible()
    // Il messaggio di stato vuoto sta DENTRO la tabella (emptymessage): con la tabella
    // vuota i due locator risolvono lo stesso blocco due volte (strict mode violation).
    await expect(detail.syncLogsTable.or(detail.syncLogsEmpty).first()).toBeVisible()
  })

  test("l'azione manuale di trasmissione a RENTRI è disponibile per un FIR non ancora sincronizzato", async ({
    page,
    context,
  }) => {
    test.skip(
      currentTargetIsProduction(),
      "Trasmettere a RENTRI ha un effetto reale sul FIR e sull'ente esterno: mai contro produzione, " +
        'anche se non è (ancora) nella blacklist distruttiva di e2e/utils/blacklist.ts.'
    )
    await loginAndSaveState(page, context, 'operator')

    const firs = await listFirs(page)
    const pendente = firs.find(
      f => f.stato !== 'BOZZA' && f.stato !== 'ANNULLATO' && f.rentriSyncStatus === 'PENDING'
    )
    test.skip(
      !pendente,
      'Nessun FIR in stato PENDING verso RENTRI (serve un tenant di test in modalità MANUALE/IBRIDA con un FIR emesso non ancora trasmesso).'
    )

    const detail = new FirDetailPage(page)
    await detail.goto(pendente!.id)
    await detail.expectLoaded()

    await expect(detail.rentriTrasmetti).toBeVisible()
    await detail.rentriTrasmetti.click()

    // Il click accoda la trasmissione (side-effect reale contro RENTRI): non
    // asseriamo l'esito finale (dipende dalla fake/l'ente esterno), solo che
    // l'azione manuale produce un riscontro visibile nella UI (toast di
    // conferma dell'accodamento, v. FirDetailComponent.trasmettiRENTRI).
    await expect(page.getByText(/trasmissione avviata/i)).toBeVisible({ timeout: 10_000 })
  })

  test("il messaggio d'errore RENTRI mostrato è comprensibile, non un codice tecnico", async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')

    const firs = await listFirs(page)
    const fallito = firs.find(
      f =>
        (f.rentriSyncStatus === 'FAILED' || f.rentriSyncStatus === 'PERMANENTLY_FAILED') &&
        !!f.rentriMessaggioErrore
    )
    test.skip(
      !fallito,
      'Nessun FIR con un fallimento RENTRI tradotto (FAILED/PERMANENTLY_FAILED + rentriMessaggioErrore) nel tenant di test.'
    )

    const detail = new FirDetailPage(page)
    await detail.goto(fallito!.id)
    await detail.expectLoaded()

    await expect(detail.rentriMessaggioErrore).toBeVisible()
    const testo = (await detail.rentriMessaggioErrore.innerText()).trim()

    // "Comprensibile" = non un codice/enum tecnico: niente SCREAMING_SNAKE_CASE
    // puro, contiene spazi (una frase), è abbastanza lungo da dire qualcosa.
    expect(testo.length).toBeGreaterThan(15)
    expect(testo).toMatch(/\s/)
    expect(testo).not.toMatch(/^[A-Z0-9_]+$/)
    expect(testo).not.toMatch(/RENTRI_[A-Z_]+/)
  })
})
