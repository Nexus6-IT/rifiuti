import { test, expect, type Locator, type Page } from '@playwright/test'
import { scriviData } from '../../utils/campo-data'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { apiGet, apiDelete, ApiClientError } from '../../utils/api-client'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { partitaIvaCasualeValida } from '../../utils/partita-iva'
import { conPrefissoUnico } from '../../utils/run-id'
import { eseguiAzioneRiga, nomiAzioniRiga } from '../../utils/azioni-riga'
import {
  ATTESA_SERVER,
  aggiungiRata,
  attendiElenco,
  attendiRisposta,
  cliccaEChiudi,
} from '../../utils/attese'

/**
 * E2E — Contratto cliente (pezzo 4.1b, Task 28): dalle tabelle di fatturazione all'annullo.
 *
 * Percorso (un solo cliente, un solo contratto, in sequenza):
 *   1. `/clienti/tabelle`: condizione di pagamento 30-60 fine mese e registro IVA.
 *   2. `/clienti`: cliente su ditta nuova; dal suo dialog si crea in linea un conto corrente e
 *      una spesa di bollo ("Nuovo conto", "Nuovo bollo"), si sceglie la condizione.
 *   3. `/contratti-clienti`: contratto trimestrale con una categoria creata in linea (modalita'
 *      rapida: solo la descrizione); l'attivazione senza registro IVA e' rifiutata col messaggio
 *      del backend; si sceglie il registro e si attiva.
 *   4. Contratto attivo: il cliente e' bloccato; si carica un PDF.
 *   5. Sospensione "solo movimenti", rinnovo (la fine passa di un anno).
 *   6. Annullo con un motivo codificato creato in linea.
 *   7. VIEWER: vede gli elenchi senza pulsanti di scrittura ne' "Nuovo ...".
 *
 * Mappa letta da:
 * - `apps/frontend/src/app/features/clienti/{clienti-list,cliente-dialog,scelta-con-nuovo}.component.ts`
 * - `apps/frontend/src/app/features/contratti-cliente/*.component.ts` (elenco, dialog, sezioni,
 *   periodi, allegati, annullo)
 * - `apps/backend/src/domain/contratti-cliente/regole-contratto-cliente.ts` (messaggi di D8)
 *
 * Isolamento: il gruppo dell'operatore lavora in un'AZIENDA DI TEST PROPRIA creata in `beforeAll`
 * (vedi utils/azienda-di-test.ts), non nell'azienda seed condivisa, i cui 99 codici dei registri
 * IVA sono esauriti nel database locale che dura nel tempo; il VIEWER non crea nulla e resta
 * sull'azienda seed.
 *
 * Il database di CI viene riusato fra due passate: codici, partita IVA, IBAN e numero del
 * contratto sono casuali per esecuzione. Pulizia in `afterAll` via API: un cliente con contratti
 * non si elimina (409) e un contratto annullato nemmeno; quello che resta in uso viene
 * DISATTIVATO (cliente, tabelle, codifiche) e non cancellato.
 */

type Tabella =
  | 'condizioni-pagamento'
  | 'conti-correnti'
  | 'spese-accessorie'
  | 'registri-iva'
  | 'codifiche-contratto'
  | 'clienti'

interface RigaApi {
  id: string
  versione: number
  codice?: string | null
  descrizione?: string
  ditta?: { ragioneSociale: string }
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const carattereCasuale = () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)]

function codiceCasuale(n: number, prefisso = ''): string {
  let c = prefisso
  while (c.length < n) c += carattereCasuale()
  return c
}

/** IBAN italiano valido con numero di conto casuale (stesso algoritmo dello spec delle tabelle). */
function ibanCasualeValido(): string {
  const cifre = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
  const bban = `X${cifre(5)}${cifre(5)}${cifre(12)}`
  const numerico = (bban + 'IT00')
    .split('')
    .map(ch => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch))
    .join('')
  const resto = Number(BigInt(numerico) % 97n)
  return `IT${String(98 - resto).padStart(2, '0')}${bban}`
}

/** PDF minimo ma riconoscibile dal backend (firma `%PDF-`). */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
)

const dati = {
  condizione: codiceCasuale(8, 'E'),
  conto: codiceCasuale(8, 'E'),
  bollo: codiceCasuale(8, 'E'),
  /** Assegnato dal test delle tabelle fra i codici liberi (01-99): vedi `scegliRegistroLibero`. */
  registro: '',
  iban: ibanCasualeValido(),
  partitaIva: partitaIvaCasualeValida(),
  numero: `E2E-${codiceCasuale(8)}`,
  nomeFile: `${codiceCasuale(6)}.pdf`,
}
/**
 * Nomi con suffisso casuale: il modulo si rivaluta a ogni tentativo (un nuovo worker dopo un
 * fallimento), cosi' un retry non trova le righe disattivate del tentativo precedente (l'elenco
 * dei clienti mostra anche i disattivati) e non va in strict mode violation.
 */
const nomi = {
  condizione: conPrefissoUnico('Condizione del cliente'),
  conto: conPrefissoUnico('Conto cliente'),
  bollo: conPrefissoUnico('Bollo cliente'),
  registro: conPrefissoUnico('Registro contratti'),
  cliente: conPrefissoUnico('Cliente contratto'),
  contratto: conPrefissoUnico('Contratto trimestrale'),
  categoria: conPrefissoUnico('Categoria del contratto'),
  motivo: conPrefissoUnico('Motivo rapido'),
}

/** Cio' che il test ha creato, nell'ordine in cui va ripulito (cliente prima delle tabelle). */
const creati: { tabella: Tabella; trova: (r: RigaApi) => boolean; query?: string }[] = []

function elencoApi(tabella: Tabella, token: string, query = ''): Promise<RigaApi[]> {
  const sep = query ? `&${query}` : ''
  if (tabella === 'clienti') {
    return apiGet<{ elementi?: RigaApi[]; righe?: RigaApi[] } | RigaApi[]>(
      `/clienti?dimensione=100&testo=${encodeURIComponent(nomi.cliente)}`,
      token
    ).then(r => (Array.isArray(r) ? r : (r.elementi ?? r.righe ?? [])))
  }
  return apiGet<RigaApi[]>(`/${tabella}?incluseDisattivate=true${sep}`, token)
}

async function disattiva(tabella: Tabella, riga: RigaApi, token: string): Promise<void> {
  const campo = tabella === 'conti-correnti' || tabella === 'registri-iva' ? 'attivo' : 'attiva'
  const corpo = { [tabella === 'clienti' ? 'attivo' : campo]: false, versione: riga.versione }
  const r = await fetch(`${getApiUrl()}/${tabella}/${riga.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo),
  })
  if (!r.ok) throw new Error(`PATCH ${tabella}/${riga.id} fallita: ${r.status} ${await r.text()}`)
}

/** Tutto cio' che non e' un dialog o un'opzione appesa al body si cerca in `#main-content`. */
function contenuto(page: Page) {
  return page.locator('#main-content')
}

function dialogo(page: Page, nome: string | RegExp): Locator {
  return page.getByRole('dialog', { name: nome })
}

/** Riempie `campo` e verifica che `Salva` si abiliti: se il form viene azzerato si riparte. */
async function compilaESalva(page: Page, dlg: Locator, riempi: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await riempi()
    await expect(dlg.getByRole('button', { name: 'Salva' })).toBeEnabled({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  // Risposta del salvataggio (attesa avviata prima del click), poi chiusura del dialog.
  await cliccaEChiudi(page, dlg.getByRole('button', { name: 'Salva' }), dlg)
}

/** Sceglie in un `<select>` nativo la voce il cui testo contiene `testo`. */
async function scegliVoce(select: Locator, testo: string): Promise<void> {
  const valore = await select.locator('option', { hasText: testo }).first().getAttribute('value')
  expect(valore, `voce "${testo}" assente dal campo`).toBeTruthy()
  await select.selectOption(valore!)
}

function rigaContratto(page: Page): Locator {
  return contenuto(page).getByRole('row', { name: new RegExp(dati.numero) })
}

async function apriContratti(page: Page): Promise<void> {
  await page.goto('/contratti-clienti')
  await expect(
    contenuto(page).getByRole('heading', { level: 1, name: 'Contratti clienti' })
  ).toBeVisible()
  // Precondizione del gruppo seriale: il contratto lo crea il test "contratto trimestrale". Se
  // manca, si fallisce subito con la causa vera invece che con un timeout a valle.
  await expect(
    rigaContratto(page),
    `precondizione: il contratto ${dati.numero} non esiste (il test "contratto trimestrale" non e' riuscito a crearlo)`
  ).toHaveCount(1, { timeout: ATTESA_SERVER })
}

/** Apre "Modifica" sul contratto e attende che il dialog abbia letto il contratto. */
async function apriModificaContratto(page: Page): Promise<Locator> {
  await rigaContratto(page).getByRole('button', { name: 'Modifica' }).click()
  const dlg = dialogo(page, 'Modifica contratto')
  await expect(dlg).toBeVisible()
  await expect(dlg.getByText('Caricamento…')).toBeHidden({ timeout: ATTESA_SERVER })
  return dlg
}

const db = clientDbLocale()
let azienda: AziendaDiTest

test.describe('Contratto cliente — operatore', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(
    db === null,
    'Serve un database locale (DATABASE_URL su localhost) per creare l’azienda di test dedicata'
  )

  test.beforeAll(async () => {
    if (!db) return
    azienda = await creaAziendaDiTest(db, 'contratto cliente')
    // Codice del registro: uno dei due cifre ancora liberi (anche fra i disattivati, che non si
    // eliminano e restano nell'elenco). Se non ce n'e' nessuno il percorso non si puo' provare.
    const occupati = new Set(
      (await elencoApi('registri-iva', await tokenAzienda(azienda, 'operator'))).map(r => r.codice)
    )
    const liberi = Array.from({ length: 90 }, (_, i) => String(10 + i)).filter(
      c => !occupati.has(c)
    )
    test.skip(
      liberi.length === 0,
      'registri IVA 10-99 tutti occupati nell azienda di prova: impossibile creare il registro del contratto'
    )
    dati.registro = liberi[Math.floor(Math.random() * liberi.length)]
  })

  test.beforeEach(async ({ page }) => {
    await accediUiComeAzienda(page, azienda, 'operator')
  })

  test.afterAll(async () => {
    await db?.$disconnect()
    if (!azienda || creati.length === 0) return
    const token = await tokenAzienda(azienda, 'operator')
    const errori: string[] = []
    // Dal piu' recente: il cliente usa le tabelle, quindi va prima di loro.
    for (const { tabella, trova, query } of [...creati].reverse()) {
      try {
        const riga = (await elencoApi(tabella, token, query)).find(trova)
        if (!riga) continue
        try {
          await apiDelete(`/${tabella}/${riga.id}?versione=${riga.versione}`, token)
        } catch (e) {
          // In uso (cliente con contratti, tabelle e codifiche usate): non si elimina, si disattiva.
          if (!(e instanceof ApiClientError) || e.status !== 409) throw e
          await disattiva(tabella, riga, token)
        }
      } catch (e) {
        errori.push(`${tabella}: ${(e as Error).message}`)
      }
    }
    expect(errori, 'pulizia delle righe create dallo spec').toEqual([])
  })

  test('tabelle: condizione di pagamento 30-60 fine mese e registro IVA', async ({ page }) => {
    creati.push({ tabella: 'condizioni-pagamento', trova: r => r.codice === dati.condizione })
    creati.push({ tabella: 'registri-iva', trova: r => r.codice === dati.registro })

    await page.goto('/clienti/tabelle')
    await expect(
      contenuto(page).getByRole('heading', { level: 1, name: 'Tabelle di fatturazione' })
    ).toBeVisible()

    await contenuto(page).getByRole('tab', { name: 'Condizioni di pagamento' }).click()
    await contenuto(page).getByRole('button', { name: 'Nuova condizione' }).click()
    const cond = dialogo(page, 'Nuova condizione di pagamento')
    // Campi compilati durante l'apertura del dialog possono andare persi su un runner lento:
    // si ricompila finche' i valori restano e `Salva` e' abilitato.
    await expect(async () => {
      await cond.getByLabel('Codice').fill(dati.condizione)
      await cond.getByLabel('Descrizione').fill(nomi.condizione)
      await expect(cond.getByLabel('Codice')).toHaveValue(dati.condizione, { timeout: 1_000 })
      await expect(cond.getByRole('button', { name: 'Salva' })).toBeEnabled({ timeout: 1_000 })
    }).toPass({ timeout: 20_000 })
    await aggiungiRata(cond, '30')
    await aggiungiRata(cond, '60')
    await cond.getByText('Fine mese', { exact: true }).click()
    await cliccaEChiudi(page, cond.getByRole('button', { name: 'Salva' }), cond)
    await expect(
      contenuto(page).getByRole('row', { name: new RegExp(dati.condizione) })
    ).toContainText('30-60 gg fine mese', { timeout: ATTESA_SERVER })

    await contenuto(page).getByRole('tab', { name: 'Registri IVA' }).click()
    await contenuto(page).getByRole('button', { name: 'Nuovo registro' }).click()
    const reg = dialogo(page, 'Nuovo registro IVA')
    await compilaESalva(page, reg, async () => {
      await reg.getByLabel('Codice').fill(dati.registro)
      await reg.getByLabel('Descrizione').fill(nomi.registro)
    })
    await expect(contenuto(page).getByTestId(`registro-riga-${dati.registro}`)).toContainText(
      nomi.registro
    )
  })

  test('cliente su ditta nuova: conto corrente e bollo creati dal suo dialog', async ({ page }) => {
    creati.push({ tabella: 'clienti', trova: r => r.ditta?.ragioneSociale === nomi.cliente })
    creati.push({ tabella: 'conti-correnti', trova: r => r.codice === dati.conto })
    creati.push({ tabella: 'spese-accessorie', trova: r => r.codice === dati.bollo })

    await page.goto('/')
    // La voce di menu "Clienti" porta all'elenco (la voce "Contratti clienti" e' sotto).
    await page.getByRole('link', { name: 'Clienti', exact: true }).click()
    await expect(contenuto(page).getByRole('heading', { level: 1, name: 'Clienti' })).toBeVisible()

    await contenuto(page).getByRole('button', { name: 'Nuovo cliente' }).click()
    const dlg = dialogo(page, 'Nuovo cliente')
    await expect(dlg).toBeVisible()

    await expect(async () => {
      await dlg.getByLabel('Ragione sociale').fill(nomi.cliente)
      await dlg.getByLabel('Partita IVA').fill(dati.partitaIva)
      await dlg.getByLabel('Via', { exact: true }).fill('Via delle Prove')
      await dlg.getByLabel('Civico').fill('7')
      await dlg.getByLabel('CAP').fill('20100')
      await dlg.getByLabel('Comune').fill('Milano')
      await dlg.getByLabel('Provincia').fill('MI')
      await expect(dlg.getByLabel('Ragione sociale')).toHaveValue(nomi.cliente, { timeout: 1_000 })
    }).toPass({ timeout: 10_000 })

    // Condizione scelta fra quelle gia' create dalle tabelle.
    await scegliVoce(dlg.getByLabel('Condizione di pagamento'), dati.condizione)

    // Conto corrente in linea: si salva e si seleziona da solo.
    await dlg.getByRole('button', { name: 'Nuovo conto' }).click()
    const conto = dialogo(page, 'Nuovo conto corrente')
    await expect(conto).toBeVisible()
    await compilaESalva(page, conto, async () => {
      await conto.getByLabel('Codice').fill(dati.conto)
      await conto.getByLabel('Descrizione').fill(nomi.conto)
      await conto.getByLabel('Banca').fill('Banca di prova')
      await conto.getByLabel('IBAN').fill(dati.iban)
    })
    await expect(dlg.getByLabel('Ns. coordinate bancarie (conto del gestore)')).toHaveValue(/.+/)

    // Bollo in linea (il tipo e' fisso).
    await dlg.getByRole('button', { name: 'Nuovo bollo' }).click()
    const bollo = dialogo(page, 'Nuova spesa accessoria')
    await expect(bollo.getByTestId('spesa-dlg-tipo-fisso')).toHaveText('Bollo')
    await compilaESalva(page, bollo, async () => {
      await bollo.getByLabel('Codice').fill(dati.bollo)
      await bollo.getByLabel('Descrizione').fill(nomi.bollo)
      await bollo.getByLabel('Importo (euro)').fill('2,00')
    })
    await expect(dlg.getByLabel('Bollo', { exact: true })).toHaveValue(/.+/)

    await expect(dlg.getByRole('button', { name: 'Salva' })).toBeEnabled()
    // Dopo il salvataggio l'elenco dei clienti si ricarica: si attende quella GET, non il tempo.
    const elencoRicaricato = attendiElenco(page, /\/clienti$/)
    await cliccaEChiudi(page, dlg.getByRole('button', { name: 'Salva' }), dlg)
    await elencoRicaricato

    // L'elenco e' paginato e conserva i clienti delle run precedenti (anche disattivati): la riga
    // nuova puo' stare in un'altra pagina. Si cerca per nome e si attende la risposta filtrata.
    const filtrato = attendiElenco(page, /\/clienti$/)
    await contenuto(page).getByRole('searchbox', { name: 'Cerca un cliente' }).fill(nomi.cliente)
    await filtrato
    const riga = contenuto(page).getByRole('row', { name: new RegExp(nomi.cliente) })
    await expect(riga).toContainText(dati.partitaIva, { timeout: ATTESA_SERVER })
    await expect(riga).toContainText(nomi.condizione)
  })

  test('contratto trimestrale: categoria in linea, bozza e attivazione negata senza registro', async ({
    page,
  }) => {
    creati.push({
      tabella: 'codifiche-contratto',
      trova: r => r.descrizione === nomi.categoria,
      query: 'genere=CATEGORIA',
    })

    // Precondizione del gruppo seriale: il cliente lo crea il test precedente.
    const token = await tokenAzienda(azienda, 'operator')
    expect(
      (await elencoApi('clienti', token)).some(r => r.ditta?.ragioneSociale === nomi.cliente),
      `precondizione: il cliente "${nomi.cliente}" non esiste (il test "cliente su ditta nuova" non e' riuscito a crearlo)`
    ).toBe(true)

    await page.goto('/')
    await page.getByRole('link', { name: 'Contratti clienti', exact: true }).click()
    await expect(
      contenuto(page).getByRole('heading', { level: 1, name: 'Contratti clienti' })
    ).toBeVisible()

    await contenuto(page).getByRole('button', { name: 'Nuovo contratto' }).click()
    const dlg = dialogo(page, 'Nuovo contratto')
    await expect(dlg).toBeVisible()

    // Il cliente si cerca per testo e si sceglie fra i suggerimenti: precompila la condizione.
    // Su un runner lento il dialog impiega a diventare editabile e la ricerca a rispondere: si
    // attende il campo abilitato, poi la risposta della ricerca (avviata prima del `fill`).
    const cliente = dlg.getByRole('combobox', { name: 'Cliente', exact: true })
    await expect(cliente).toBeEnabled({ timeout: ATTESA_SERVER })
    const ricerca = page.waitForResponse(
      r =>
        r.request().method() === 'GET' &&
        new URL(r.url()).pathname.endsWith('/clienti') &&
        new URL(r.url()).searchParams.get('testo') === nomi.cliente,
      { timeout: ATTESA_SERVER }
    )
    ricerca.catch(() => undefined)
    await cliente.fill(nomi.cliente)
    expect((await ricerca).ok(), 'ricerca del cliente per testo').toBe(true)
    const opzione = page.getByRole('option', { name: new RegExp(nomi.cliente) })
    await opzione.click({ timeout: ATTESA_SERVER })
    // L'effetto della scelta si verifica sul campo e sulla condizione precompilata, non sul
    // pannello dei suggerimenti (che si chiude con un'animazione e puo' riaprirsi per una
    // ricerca tardiva).
    await expect(cliente).toHaveValue(new RegExp(nomi.cliente), { timeout: ATTESA_SERVER })
    await expect(dlg.getByLabel('Condizione di pagamento')).not.toHaveValue('', {
      timeout: ATTESA_SERVER,
    })
    await expect(opzione).toBeHidden({ timeout: ATTESA_SERVER })

    // Categoria in linea, modalita' rapida: solo la descrizione, il codice lo da' il server.
    await dlg.getByRole('button', { name: 'Nuova categoria' }).click()
    const cat = dialogo(page, 'Nuova categoria')
    await expect(cat).toBeVisible()
    await expect(cat.getByLabel('Codice', { exact: false })).toHaveCount(0)
    await compilaESalva(page, cat, async () => {
      await cat.getByLabel('Descrizione').fill(nomi.categoria)
    })
    await expect(dlg.getByLabel('Categoria', { exact: true })).not.toHaveValue('')

    await expect(async () => {
      await dlg.getByLabel('Numero', { exact: true }).fill(dati.numero)
      await dlg.getByLabel('Descrizione', { exact: true }).fill(nomi.contratto)
      await scriviData(page, dlg.getByLabel('Data di inizio'), '2026-01-01')
      await scriviData(page, dlg.getByLabel('Data di fine'), '2027-12-31')
      await expect(dlg.getByLabel('Numero', { exact: true })).toHaveValue(dati.numero, {
        timeout: 1_000,
      })
      await expect(dlg.getByLabel('Data di fine')).toHaveValue('31/12/2027', { timeout: 1_000 })
    }).toPass({ timeout: 10_000 })

    // Periodi: la frequenza genera i quattro trimestri.
    await dlg.getByRole('button', { name: 'Trimestrale' }).click()
    await expect(
      dlg.getByRole('table', { name: 'Periodi di fatturazione' }).getByRole('row')
    ).toHaveCount(5) // intestazione + 4 periodi

    await cliccaEChiudi(page, dlg.getByRole('button', { name: 'Salva' }), dlg)

    const riga = rigaContratto(page)
    await expect(riga).toContainText('Bozza')
    await expect(riga).toContainText(nomi.cliente)
    await expect(riga).toContainText(nomi.categoria)
    // Prossima fatturazione: con i trimestri generati e' una data (colonna non vuota).
    await expect(riga).toContainText(
      /\d{2}\/\d{2}\/\d{4}.*\d{2}\/\d{2}\/\d{4}.*\d{2}\/\d{2}\/\d{4}/
    )

    // Attivazione senza registro IVA: rifiutata col messaggio del backend, resta in bozza.
    // Il rifiuto e' atteso (4xx): si aspetta la risposta, poi il messaggio.
    await attendiRisposta(page, () => eseguiAzioneRiga(page, riga, 'Attiva'), {
      stato: [400, 409, 422],
    })
    await expect(page.getByText('Per attivare il contratto indica il registro IVA.')).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await expect(riga).toContainText('Bozza')
  })

  test('completa con il registro e attiva', async ({ page }) => {
    await apriContratti(page)
    const dlg = await apriModificaContratto(page)
    await scegliVoce(dlg.getByLabel('Registro IVA', { exact: true }), nomi.registro)
    await cliccaEChiudi(page, dlg.getByRole('button', { name: 'Salva' }), dlg)

    const riga = rigaContratto(page)
    await attendiRisposta(page, () => eseguiAzioneRiga(page, riga, 'Attiva'))
    await expect(riga).toContainText('Attivo', { timeout: ATTESA_SERVER })
    expect(await nomiAzioniRiga(page, riga)).toContain('Sospendi solo movimenti')
  })

  test('contratto attivo: cliente bloccato e PDF caricato', async ({ page }) => {
    await apriContratti(page)
    const dlg = await apriModificaContratto(page)

    // Il cliente di un contratto attivo non si cambia: campo disabilitato e niente "Nuovo cliente".
    await expect(dlg.getByRole('combobox', { name: 'Cliente', exact: true })).toBeDisabled()
    // "Nuovo cliente" accanto al campo del cliente (quello della fatturazione puo' restare).
    await expect(dlg.getByTestId('contratto-dlg-nuovo-cliente')).toHaveCount(0)

    // PDF 1: l'input e' nascosto, il pulsante "Carica" lo apre.
    await dlg.getByTestId('allegato-file-1').setInputFiles({
      name: dati.nomeFile,
      mimeType: 'application/pdf',
      buffer: PDF,
    })
    await expect(dlg.getByTestId('allegato-nome-1')).toContainText(dati.nomeFile)
    await expect(dlg.getByTestId('allegato-nome-2')).toContainText('Nessun file')
    await expect(dlg.getByTestId('allegati-errore')).toHaveCount(0)

    await dlg.getByRole('button', { name: 'Annulla', exact: true }).click()
    await expect(dlg).toBeHidden()
  })

  test('sospende solo i movimenti e rinnova', async ({ page }) => {
    await apriContratti(page)
    const riga = rigaContratto(page)
    await expect(riga).toContainText('31/12/2027')

    await eseguiAzioneRiga(page, riga, 'Sospendi solo movimenti')
    await expect(riga).toContainText('Sospeso (solo movimenti)')

    await eseguiAzioneRiga(page, riga, 'Rinnova')
    const conferma = page
      .getByRole('alertdialog')
      .or(page.getByRole('dialog', { name: /rinnovo/i }))
    await expect(conferma).toContainText('31/12/2027')
    await expect(conferma).toContainText('31/12/2028')
    await cliccaEChiudi(
      page,
      conferma.getByRole('button', { name: 'Rinnova', exact: true }),
      conferma
    )
    await expect(riga).toContainText('31/12/2028')
    // Il rinnovo non cambia lo stato.
    await expect(riga).toContainText('Sospeso (solo movimenti)')
  })

  test('annulla con un motivo codificato creato in linea', async ({ page }) => {
    creati.push({
      tabella: 'codifiche-contratto',
      trova: r => r.descrizione === nomi.motivo,
      query: 'genere=MOTIVO_ANNULLO',
    })

    await apriContratti(page)
    const riga = rigaContratto(page)
    await eseguiAzioneRiga(page, riga, /Annulla il contratto/)

    const annullo = dialogo(page, new RegExp(`Annulla il contratto ${dati.numero}`))
    await expect(annullo).toBeVisible()
    // Senza motivo il pulsante di conferma e' spento.
    await expect(annullo.getByRole('button', { name: 'Annulla il contratto' })).toBeDisabled()

    await annullo.getByRole('button', { name: 'Nuovo motivo' }).click()
    const motivo = dialogo(page, /^Nuovo motivo/)
    await expect(motivo).toBeVisible()
    await compilaESalva(page, motivo, async () => {
      await motivo.getByLabel('Descrizione').fill(nomi.motivo)
    })

    await expect(annullo.getByRole('button', { name: 'Annulla il contratto' })).toBeEnabled()
    await cliccaEChiudi(
      page,
      annullo.getByRole('button', { name: 'Annulla il contratto' }),
      annullo
    )

    await expect(riga).toContainText('Annullato')
    // Annullato = definitivo: nessuna transizione, nessun rinnovo, nessuna eliminazione.
    // (il filtro esclude solo «Modifica»: se la riga avra' un altro bottone non di scrittura,
    // va aggiunto qui)
    const azioni = await nomiAzioniRiga(page, riga)
    expect(azioni.filter(n => !/^Modifica/.test(n))).toEqual([])
  })
})

test.describe('Contratto cliente — VIEWER', () => {
  test.skip(!hasRoleCredentials('viewer'), skipReason('viewer'))

  test('vede clienti e contratti senza pulsanti di scrittura', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'viewer')

    await page.goto('/contratti-clienti')
    await expect(
      contenuto(page).getByRole('heading', { level: 1, name: 'Contratti clienti' })
    ).toBeVisible()
    await expect(contenuto(page).getByRole('table')).toBeVisible()
    await expect(contenuto(page).getByRole('button', { name: 'Nuovo contratto' })).toHaveCount(0)
    await expect(contenuto(page).getByRole('button', { name: 'Proroga scadenze' })).toHaveCount(0)
    await expect(contenuto(page).getByRole('columnheader', { name: 'Azioni' })).toHaveCount(0)
    // `all()` e' una foto istantanea: prima si aspetta che l'elenco sia arrivato (una riga di
    // dati o il messaggio di lista vuota: il DB della CI parte senza contratti), altrimenti il ciclo
    // girerebbe su una tabella ancora in caricamento
    await expect(
      contenuto(page)
        .locator('tbody tr[data-testid^="contratti-riga-"]')
        .first()
        .or(contenuto(page).getByRole('cell', { name: 'Nessun contratto.' }))
    ).toBeVisible({ timeout: ATTESA_SERVER })
    for (const riga of await contenuto(page)
      .locator('tbody tr[data-testid^="contratti-riga-"]')
      .all()) {
      const nomi = await nomiAzioniRiga(page, riga)
      expect(
        nomi.filter(n => /^(Modifica|Attiva|Riattiva|Sospendi|Annulla|Rinnova|Elimina)/.test(n))
      ).toEqual([])
    }

    await page.goto('/clienti')
    await expect(contenuto(page).getByRole('heading', { level: 1, name: 'Clienti' })).toBeVisible()
    await expect(contenuto(page).getByRole('table')).toBeVisible()
    await expect(contenuto(page).getByRole('button', { name: 'Nuovo cliente' })).toHaveCount(0)
    await expect(contenuto(page).getByRole('columnheader', { name: 'Azioni' })).toHaveCount(0)
    await expect(
      contenuto(page)
        .locator('tbody tr[data-testid^="clienti-riga-"]')
        .first()
        .or(contenuto(page).getByRole('cell', { name: 'Nessun cliente.' }))
    ).toBeVisible({ timeout: ATTESA_SERVER })
    for (const riga of await contenuto(page)
      .locator('tbody tr[data-testid^="clienti-riga-"]')
      .all()) {
      const nomi = await nomiAzioniRiga(page, riga)
      expect(nomi.filter(n => /^(Modifica|Disattiva|Riattiva|Elimina)/.test(n))).toEqual([])
    }
  })
})
