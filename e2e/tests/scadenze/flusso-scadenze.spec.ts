import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials } from '../../utils/env'
import { apiLogin, apiPost, apiGet, ApiClientError } from '../../utils/api-client'
import { registra } from '../../fixtures/risorse'
import { conPrefisso } from '../../utils/run-id'
import { giornoItaliano } from '../../utils/legami-api'
import { AnagrafichePage } from '../../pages/anagrafiche.page'
import { DashboardPage } from '../../pages/dashboard.page'
import { partitaIvaCasualeValida } from '../../utils/partita-iva'

/**
 * UAT/E2E — Il flusso delle scadenze dal dato all'avviso (Task 5 del piano).
 * Mappa e casi in `docs/uat/scadenze.md`.
 *
 * Qui si prova ciò che nessun test per entità può provare: che il dato
 * (un'anagrafica in scadenza) attraversa il cron, la notifica in
 * applicazione e il cruscotto restando coerente — non solo che ognuno dei
 * tre pezzi, isolato, funziona.
 *
 * PASSO 1 DEL BRIEF, risolto dal committente prima di scrivere questo file
 * (v. `job-actions.service.spec.ts` e il report della sessione):
 * verificato su `apps/backend/src/application/admin/system-health/job-actions.service.ts`
 * che le quattro azioni manuali esistenti NON innescavano mai
 * `DeadlineCheckerService` — il cron giornaliero (10:00) delle scadenze di
 * autorizzazioni impianto, iscrizione Albo Gestori dei trasportatori e
 * autorizzazione dei destinatari. È stata aggiunta una quinta azione,
 * `scadenzario-autorizzazioni`, che chiama
 * `DeadlineCheckerService.checkAuthorizationExpirations()` — stessa forma
 * delle quattro sorelle (202 «avviato», lucchetto per chiave, audit),
 * riservata al SUPER_ADMIN. Questo file la usa per innescare il controllo
 * senza aspettare le 10:00.
 *
 * SCELTA DEI DATI: si usa il Trasportatore (`scadenzaIscrizione`), non
 * l'AutorizzazioneImpianto, perché il Trasportatore ha un endpoint di
 * registro (`POST/DELETE /registry/trasportatori`) già tracciato dal
 * teardown della suite (`fixtures/risorse.ts`) e una pagina reale
 * (`/trasportatori`) verso cui il pulsante del cruscotto deve navigare — le
 * autorizzazioni impianto non hanno né l'uno né l'altro (v. commento in
 * `raccogli-attenzione.use-case.ts`: nessuna `azione` per quella voce).
 *
 * DELTA SCOPED, non un conteggio grezzo: `GET /notifications` filtra già
 * per l'utente che chiama (un solo tenant/utente di test è condiviso da
 * TUTTA la suite E2E, non solo da questo file), quindi un conteggio totale
 * "prima/dopo" rischierebbe falsi positivi/negativi per rumore di altri
 * test in esecuzione parallela sullo stesso utente. Il delta qui è quindi
 * filtrato per `type === 'TRASPORTATORE_ISCRIZIONE_IN_SCADENZA'` e per il
 * `numeroIscrizione` (univoco per invocazione, embeddato nel titolo da
 * `DeadlineCheckerService.elaboraScadenzaControparte`) del trasportatore
 * creato da QUESTO test — resta un delta (mai un totale assoluto), solo
 * più preciso di un conteggio grezzo che il resto della suite renderebbe
 * inaffidabile.
 *
 * PASSO 5 DEL BRIEF — RISERVA dichiarata (v. anche report della sessione e
 * `docs/uat/scadenze.md` §4): il brief chiede che «senza nulla in scadenza
 * la fascia non compare affatto», cioè l'INTERO `data-testid="attenzione-fascia"`
 * assente. Il tenant di test è condiviso da tutta la suite E2E (v.
 * `e2e/README.md`, "Cosa manca per completare la suite" punto 1): non c'è
 * modo di garantire, da qui, che nessun'ALTRA scadenza (certificato RENTRI,
 * autorizzazione impianto, altro trasportatore/destinatario creato da un
 * altro test o da una run precedente non ripulita) sia presente nello
 * stesso momento — l'assenza totale della fascia già ha una copertura
 * solida e non fragile a livello di componente
 * (`da-fare-oggi.component.spec.ts` — "non mostra alcuna fascia quando non ci
 * sono voci"). Il test qui sotto verifica invece, end-to-end attraverso
 * tutto lo stack reale (DB → use case → controller → rendering), la stessa
 * garanzia SCOPED al dato di questo test: un trasportatore con scadenza
 * ben oltre la soglia dei 30 giorni non produce alcuna voce per sé nel
 * cruscotto — stesso principio della regressione da impedire, verificabile
 * senza dipendere dallo stato dell'intero tenant condiviso.
 */

const SEDE_VALIDA = {
  via: 'Via Roma',
  civico: '1',
  cap: '20100',
  comune: 'Milano',
  provincia: 'MI',
}

const JOB_KEY = 'scadenzario-autorizzazioni'
const TIPO_NOTIFICA_TRASPORTATORE = 'TRASPORTATORE_ISCRIZIONE_IN_SCADENZA'

function nuovaPartitaIVA(): string {
  return partitaIvaCasualeValida()
}

function nuovoNumeroIscrizione(): string {
  return `MI/${Math.floor(Math.random() * 900000 + 100000)}`
}

interface TrasportatoreResponse {
  id: string
  ragioneSociale: string
  numeroIscrizione: string
}

interface NotificaResponse {
  type: string
  title: string
}

interface EsitoAvvioJob {
  jobKey: string
  stato: string
  messaggio: string
  avviatoAl: string
}

interface EventoAuditJob {
  jobKey: string
  esito: string
  descrizione: string
  utente: string | null
  al: string
}

function payloadTrasportatore(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ragioneSociale: conPrefisso('Trasportatore Scadenzario SRL'),
    partitaIVA: nuovaPartitaIVA(),
    sedeLegale: SEDE_VALIDA,
    numeroIscrizione: nuovoNumeroIscrizione(),
    pec: 'pec@esempio.it',
    ...overrides,
  }
}

/** Ieri (scadenza già passata) in formato ISO (solo giorno). */
function ieriIso(): string {
  return giornoItaliano(-1)
}

/** Fra due anni: ben oltre la soglia di 30 giorni del cruscotto (Passo 5). */
function fraDueAnniIso(): string {
  const oggi = giornoItaliano()
  return `${Number(oggi.slice(0, 4)) + 2}${oggi.slice(4)}`
}

/** Avvia a mano il job scadenzario tramite l'azione SUPER_ADMIN. */
async function avviaScadenzarioUnaVolta(token: string): Promise<EsitoAvvioJob> {
  return apiPost<EsitoAvvioJob>(`/admin/system-health/actions/${JOB_KEY}/run`, {}, token)
}

/**
 * Avvia il job scadenzario, tollerando la finestra di gara fra "l'audit
 * segna completato" (quello che `attendiCompletamento` aspetta) e "il
 * lucchetto e' davvero rilasciato" — in `JobActionsService.avvia()` la
 * scrittura dell'audit ('completato') avviene nel `.then()` della catena,
 * e SOLO DOPO, nel `.finally()` concatenato, `this.inCorso.delete(jobKey)`
 * libera il lucchetto. Chiamare `avviaScadenzarioUnaVolta` subito dopo che
 * il poll ha visto "completato" puo' quindi ricevere ancora un 409 (job
 * "gia' in corso") per una manciata di millisecondi: non un errore reale,
 * solo quella finestra. Qui si ritenta finche' il 409 non sparisce, mai a
 * tempo fisso.
 */
async function avviaScadenzario(token: string): Promise<EsitoAvvioJob> {
  let ultimoErrore: unknown
  const scadenza = Date.now() + 10_000
  while (Date.now() < scadenza) {
    try {
      return await avviaScadenzarioUnaVolta(token)
    } catch (errore) {
      if (errore instanceof ApiClientError && errore.status === 409) {
        ultimoErrore = errore
        await new Promise(resolve => setTimeout(resolve, 200))
        continue
      }
      throw errore
    }
  }
  throw new Error(
    `avvio di "${JOB_KEY}" ancora in conflitto (409) dopo 10s di ritentativi — non e' piu' la ` +
      `finestra di rilascio del lucchetto, probabile job davvero bloccato: ${String(ultimoErrore)}`
  )
}

/**
 * Attende — SU CONDIZIONE, mai a tempo fisso — che l'esecuzione avviata in
 * `avviatoAl` compaia nello storico come «completato». La chiamata di avvio
 * risponde 202 subito (v. `JobActionsService`, regola 2): il giro vero e
 * proprio avviene in background, e l'unico modo di sapere che è finito è
 * leggerlo nello storico, esattamente come farebbe un amministratore reale
 * dalla pagina «Stato del sistema».
 */
async function attendiCompletamento(token: string, avviatoAl: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const storico = await apiGet<EventoAuditJob[]>(
          '/admin/system-health/actions/audit?limit=50',
          token
        )
        return storico.some(
          evento =>
            evento.jobKey === JOB_KEY && evento.esito === 'completato' && evento.al >= avviatoAl
        )
      },
      {
        message: `il job "${JOB_KEY}" avviato alle ${avviatoAl} non risulta completato nello storico`,
        timeout: 60_000,
        intervals: [500, 1_000, 2_000],
      }
    )
    .toBe(true)
}

/**
 * Conta, fra le notifiche dell'utente/azienda corrente, quelle generate dal
 * controllo scadenze per QUESTO trasportatore (v. nota sul delta scoped in
 * cima al file).
 */
async function contaNotificheTrasportatore(
  token: string,
  numeroIscrizione: string
): Promise<number> {
  const notifiche = await apiGet<NotificaResponse[]>('/notifications?limit=100', token)
  return notifiche.filter(
    notifica =>
      notifica.type === TIPO_NOTIFICA_TRASPORTATORE && notifica.title.includes(numeroIscrizione)
  ).length
}

test.describe('Scadenzario — flusso dal dato al cruscotto', () => {
  test.skip(
    !hasRoleCredentials('operator') || !hasRoleCredentials('superAdmin'),
    `${skipReason('operator')} / ${skipReason('superAdmin')}`
  )

  test('trasportatore scaduto: delta di notifiche esatto, dedup a 7 giorni, voce in cruscotto con navigazione reale', async ({
    page,
    context,
  }) => {
    const operatorToken = await apiLogin('operator')
    const superAdminToken = await apiLogin('superAdmin')

    const ragioneSociale = conPrefisso('Trasportatore Scadenzario SRL')
    const numeroIscrizione = nuovoNumeroIscrizione()
    const body = payloadTrasportatore({
      ragioneSociale,
      numeroIscrizione,
      scadenzaIscrizione: ieriIso(),
    })
    const trasportatore = await apiPost<TrasportatoreResponse>(
      '/registry/trasportatori',
      body,
      operatorToken
    )
    registra('trasportatore', trasportatore.id)

    // --- Passo 2: delta esatto, mai un totale assoluto ---
    const primaDelPrimoGiro = await contaNotificheTrasportatore(operatorToken, numeroIscrizione)

    const esitoPrimoGiro = await avviaScadenzario(superAdminToken)
    expect(esitoPrimoGiro).toMatchObject({ jobKey: JOB_KEY, stato: 'avviato' })

    await attendiCompletamento(superAdminToken, esitoPrimoGiro.avviatoAl)
    const dopoIlPrimoGiro = await contaNotificheTrasportatore(operatorToken, numeroIscrizione)

    expect(
      dopoIlPrimoGiro - primaDelPrimoGiro,
      'il primo giro deve generare esattamente una notifica per il trasportatore appena creato'
    ).toBe(1)

    // --- Passo 3: dedup a 7 giorni — il secondo giro non ripete l'avviso ---
    const esitoSecondoGiro = await avviaScadenzario(superAdminToken)
    expect(esitoSecondoGiro).toMatchObject({ jobKey: JOB_KEY, stato: 'avviato' })

    await attendiCompletamento(superAdminToken, esitoSecondoGiro.avviatoAl)
    const dopoIlSecondoGiro = await contaNotificheTrasportatore(operatorToken, numeroIscrizione)

    expect(
      dopoIlSecondoGiro - dopoIlPrimoGiro,
      'un secondo giro immediato non deve generare una seconda notifica identica (dedup 7gg)'
    ).toBe(0)

    // --- Passo 4: la voce compare in cruscotto, il pulsante naviga davvero ---
    await loginAndSaveState(page, context, 'operator')
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    await dashboard.expectLoaded()

    // Il `chiave` di questa voce ('trasportatore-iscrizione') è condiviso da
    // TUTTI i trasportatori scaduti del tenant (v. `raccogli-attenzione.use-case.ts`,
    // `vociTrasportatoriInScadenza`): si filtra per la ragione sociale, unica
    // per questa esecuzione, per prendere la voce del NOSTRO trasportatore.
    const voce = page
      .getByTestId('attenzione-voce-trasportatore-iscrizione')
      .filter({ hasText: ragioneSociale })
    await expect(voce).toBeVisible()

    await voce.getByTestId('attenzione-azione-trasportatore-iscrizione').click()

    // Rotte morte già state un difetto critico (2026-09-11): si verifica la
    // navigazione REALE, non solo la presenza dell'attributo `routerLink`.
    const trasportatori = new AnagrafichePage(page, 'trasportatori')
    await trasportatori.expectLoaded()
  })

  test('trasportatore con scadenza fra due anni: nessuna voce di attenzione per lui in cruscotto', async ({
    page,
    context,
  }) => {
    const operatorToken = await apiLogin('operator')

    const ragioneSociale = conPrefisso('Trasportatore Scadenzario Lontano SRL')
    const body = payloadTrasportatore({
      ragioneSociale,
      numeroIscrizione: nuovoNumeroIscrizione(),
      scadenzaIscrizione: fraDueAnniIso(),
    })
    const trasportatore = await apiPost<TrasportatoreResponse>(
      '/registry/trasportatori',
      body,
      operatorToken
    )
    registra('trasportatore', trasportatore.id)

    await loginAndSaveState(page, context, 'operator')
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    await dashboard.expectLoaded()

    // Nessuna voce (di nessuna gravità) deve nominare questo trasportatore:
    // una scadenza a due anni è ben oltre la soglia di 30 giorni della
    // fascia (v. `raccogli-attenzione.use-case.ts`, `SOGLIA_AVVISO_GIORNI`).
    await expect(page.getByText(ragioneSociale)).toHaveCount(0)
  })
})
