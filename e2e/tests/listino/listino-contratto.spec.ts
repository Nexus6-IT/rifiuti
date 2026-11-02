import { test, expect, type Locator, type Page } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { apiLogin, apiGet, apiPost, ApiClientError } from '../../utils/api-client'
import { partitaIvaCasualeValida } from '../../utils/partita-iva'
import { conPrefissoUnico } from '../../utils/run-id'
import { ATTESA_SERVER, attendiElenco, cliccaEAttendi, cliccaEChiudi } from '../../utils/attese'

/**
 * E2E — Listino del contratto (pezzo 4.2b, Task 30): dall'elenco all'adeguamento ISTAT.
 *
 * Percorso (un cliente, tre contratti, in sequenza):
 *   1. Dalla lista dei contratti, "Listino" del contratto A (attivo): elenco 001 predefinito.
 *   2. Riga CER (15 01 01) a peso netto con prezzo speciale tipo A a tre fasce.
 *   3. Riga `V` dall'archivio: il prezzo viene proposto dal listino 2 del cliente.
 *   4. Riga `F` trimestrale con il calendario automatico.
 *   5. Riga `MW` e un secondo `MW` (di un altro addebito) rifiutato col messaggio del backend.
 *   6. Copia dell'elenco sul contratto B: l'esito dice che il minimo non si copia.
 *   7. Provvigione 5 % su tutto il contratto A (la riga a prezzo speciale non si tocca).
 *   8. Modifica automatica dei prezzi +3 % sui soli CER, con anteprima e conferma, filtrata sul
 *      contratto A e sul codice CER della riga.
 *   9. Adeguamento ISTAT sul contratto B (flag acceso, mese di inizio casuale e libero di un anno
 *      fra il 1995 e il 2015).
 *  10. Allegato del contratto A al contratto C: rifiutato ("tipo diverso da T").
 *  11. Annullo del contratto A: il listino diventa di sola lettura.
 *  12. VIEWER: legge il listino senza pulsanti di scrittura.
 *
 * Isolamento (R52): tutti i dati (cliente con P.IVA valida, contratti, archivio addebiti, codice
 * IVA, gruppo, registro, condizione) si creano via API in `beforeAll` con nomi casuali per
 * tentativo; il cliente non ha altri contratti, quindi variazione e ISTAT toccano solo i suoi.
 * La variazione e' filtrata sul contratto scelto nella lista e sul CER; l'ISTAT usa un mese di
 * inizio che nessun altro contratto dell'azienda ha. I decimali si scrivono con la virgola
 * (regola di Graziano: il punto e' rifiutato dall'interfaccia).
 *
 * Pulizia in `afterAll`, per id esatti: contratti (eliminati, o annullati se in uso), cliente,
 * addebiti, codice IVA, gruppo, registro e condizione (eliminati, o disattivati se in uso).
 */

interface Versionata {
  id: string
  versione: number
}

interface Creato {
  tipo:
    | 'contratti-clienti'
    | 'clienti'
    | 'addebiti'
    | 'codici-iva'
    | 'codifiche-addebito'
    | 'registri-iva'
    | 'condizioni-pagamento'
  id: string
}

const CER = '15 01 01'

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function codiceCasuale(n: number): string {
  let c = ''
  while (c.length < n) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)]
  return c
}

/** Dati del tentativo: si rigenerano in `beforeAll`, cosi' un retry non trova quelli di prima. */
const d = {
  cliente: '',
  numeroA: '',
  numeroB: '',
  numeroC: '',
  gruppo: '',
  addebitoV: '',
  addebitoF: '',
  addebitoMw: '',
  addebitoMw2: '',
  annoIstat: 0,
  meseIstat: 0,
  ids: { A: '', B: '', C: '', cliente: '' },
  codiceV: '',
  codiceF: '',
  codiceMw: '',
  codiceMw2: '',
}

/** Cio' che il tentativo ha creato, in ordine di creazione (si ripulisce al contrario). */
let creati: Creato[] = []

function pagina(page: Page): Locator {
  return page.locator('#main-content')
}

function dialogo(page: Page, nome: string | RegExp): Locator {
  return page.getByRole('dialog', { name: nome })
}

async function apiPatch<T>(percorso: string, corpo: unknown, token: string): Promise<T> {
  const r = await fetch(`${getApiUrl()}${percorso}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo),
  })
  if (!r.ok)
    throw new ApiClientError(`PATCH ${percorso}: ${r.status} ${await r.text()}`, r.status, null)
  return (await r.json()) as T
}

async function apiElimina(percorso: string, token: string): Promise<number> {
  const r = await fetch(`${getApiUrl()}${percorso}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  return r.status
}

/** Registra cio' che l'API ha creato e restituisce la risposta. */
async function crea<T extends Versionata>(
  tipo: Creato['tipo'],
  corpo: unknown,
  token: string
): Promise<T> {
  const risposta = await apiPost<Record<string, unknown>>(`/${tipo}`, corpo, token)
  // Clienti e contratti rispondono con la riga dentro un oggetto ({ cliente }, { contratto }).
  const r = ('id' in risposta
    ? risposta
    : Object.values(risposta).find(
        v => typeof v === 'object' && v !== null && 'id' in v
      )) as unknown as T
  creati.push({ tipo, id: r.id })
  return r
}

/** Un mese di inizio (anno 1995-2015) che nessun contratto dell'azienda ha gia' col flag ISTAT. */
async function meseIstatLibero(token: string): Promise<{ anno: number; mese: number }> {
  const occupati = new Set(
    (
      await apiGet<{ anno: number; mese: number }[]>(
        '/variazioni-prezzi/istat/mesi?ancheAnnoPrecedente=true',
        token
      )
    ).map(m => `${m.anno}-${m.mese}`)
  )
  for (let i = 0; i < 200; i++) {
    const anno = 1995 + Math.floor(Math.random() * 21)
    const mese = 1 + Math.floor(Math.random() * 12)
    if (!occupati.has(`${anno}-${mese}`)) return { anno, mese }
  }
  throw new Error('nessun mese ISTAT libero fra il 1995 e il 2015')
}

const giorno = (anno: number, mese: number) => `${anno}-${String(mese).padStart(2, '0')}-01`

test.describe('Listino del contratto — admin', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!hasRoleCredentials('admin'), skipReason('admin'))

  test.beforeAll(async () => {
    if (!hasRoleCredentials('admin')) return
    creati = []
    const token = await apiLogin('admin')
    d.cliente = conPrefissoUnico('Cliente listino')
    d.numeroA = `L-${codiceCasuale(8)}`
    d.numeroB = `L-${codiceCasuale(8)}`
    d.numeroC = `L-${codiceCasuale(8)}`
    d.gruppo = conPrefissoUnico('Gruppo')
    d.addebitoV = conPrefissoUnico('Servizio V')
    d.addebitoF = conPrefissoUnico('Canone F')
    d.addebitoMw = conPrefissoUnico('Minimo MW')
    d.addebitoMw2 = conPrefissoUnico('Minimo MW due')

    // Tabelle di fatturazione che l'attivazione richiede.
    const registriEsistenti = new Set(
      (await apiGet<{ codice: string }[]>('/registri-iva?incluseDisattivate=true', token)).map(
        r => r.codice
      )
    )
    // I codici dei registri sono 99 e quelli in uso (anche disattivati) non si riusano: se sono
    // finiti lo si dice, invece di girare a vuoto.
    const liberi = Array.from({ length: 99 }, (_, n) => String(n + 1).padStart(2, '0')).filter(
      c => !registriEsistenti.has(c)
    )
    if (liberi.length === 0) {
      throw new Error('Nessun codice di registro IVA libero (01-99): ripulire i registri di prova.')
    }
    const codiceRegistro = liberi[Math.floor(Math.random() * liberi.length)]
    const registro = await crea<Versionata>(
      'registri-iva',
      { codice: codiceRegistro, descrizione: conPrefissoUnico('Registro'), ricevuteSplit: false },
      token
    )
    const condizione = await crea<Versionata>(
      'condizioni-pagamento',
      {
        codice: codiceCasuale(8),
        descrizione: conPrefissoUnico('Condizione'),
        modalita: 'MP05',
        giorniRate: [30],
        fineMese: false,
      },
      token
    )

    const cliente = await crea<Versionata>(
      'clienti',
      {
        ragioneSociale: d.cliente,
        partitaIva: partitaIvaCasualeValida(),
        indirizzo: {
          via: 'Via delle Prove',
          civico: '7',
          cap: '20100',
          comune: 'Milano',
          provincia: 'MI',
        },
        listino: 2,
      },
      token
    )
    d.ids.cliente = cliente.id

    // Archivio: un gruppo, un codice IVA e quattro addebiti (V, F e due MW).
    const gruppo = await crea<Versionata>(
      'codifiche-addebito',
      { genere: 'GRUPPO', descrizione: d.gruppo },
      token
    )
    const iva = await crea<Versionata>(
      'codici-iva',
      { codice: codiceCasuale(3), descrizione: conPrefissoUnico('IVA 22'), aliquota: '22' },
      token
    )
    const addebito = async (
      descrizione: string,
      tipo: string,
      listini: { numero: number; prezzo: string }[]
    ) =>
      crea<Versionata & { codice: string }>(
        'addebiti',
        {
          descrizione,
          gruppoId: gruppo.id,
          unitaMisura: 'NR',
          codiceIvaId: iva.id,
          tipo,
          listini,
        },
        token
      )
    d.codiceV = (
      await addebito(d.addebitoV, 'V', [
        { numero: 1, prezzo: '5.00' },
        { numero: 2, prezzo: '10.00' },
      ])
    ).codice
    d.codiceF = (await addebito(d.addebitoF, 'F', [{ numero: 2, prezzo: '100.00' }])).codice
    d.codiceMw = (await addebito(d.addebitoMw, 'MW', [{ numero: 2, prezzo: '50.00' }])).codice
    d.codiceMw2 = (await addebito(d.addebitoMw2, 'MW', [{ numero: 2, prezzo: '60.00' }])).codice

    // Tre contratti attivi dello stesso cliente. B ha il flag ISTAT e inizia in un mese libero.
    const { anno, mese } = await meseIstatLibero(token)
    d.annoIstat = anno
    d.meseIstat = mese
    const contratto = async (numero: string, dataInizio: string, istat: boolean) => {
      const c = await crea<Versionata>(
        'contratti-clienti',
        {
          numero,
          descrizione: conPrefissoUnico('Contratto'),
          clienteId: cliente.id,
          dataInizio,
          condizionePagamentoId: condizione.id,
          registroIvaId: registro.id,
          incrementoIstat: istat,
        },
        token
      )
      await apiPatch(
        `/contratti-clienti/${c.id}/stato`,
        { stato: 'ATTIVO', versione: c.versione },
        token
      )
      return c.id
    }
    d.ids.A = await contratto(d.numeroA, '2026-01-01', false)
    d.ids.B = await contratto(d.numeroB, giorno(anno, mese), true)
    d.ids.C = await contratto(d.numeroC, '2026-01-01', false)
  })

  test.afterAll(async () => {
    if (!hasRoleCredentials('admin') || creati.length === 0) return
    const token = await apiLogin('admin')
    const errori: string[] = []
    for (const { tipo, id } of [...creati].reverse()) {
      try {
        if (tipo === 'contratti-clienti') {
          if ((await apiElimina(`/${tipo}/${id}`, token)) >= 400) {
            // In uso (ha elenchi o e' attivo): si annulla, cosi' non entra piu' in variazioni e ISTAT.
            const c = await apiGet<Versionata & { stato: string }>(`/${tipo}/${id}`, token)
            if (c.stato !== 'ANNULLATO') {
              await apiPatch(
                `/${tipo}/${id}/stato`,
                { stato: 'ANNULLATO', versione: c.versione, motivo: 'Pulizia della prova e2e' },
                token
              )
            }
          }
          continue
        }
        if ((await apiElimina(`/${tipo}/${id}`, token)) < 400) continue
        // In uso: si disattiva. Il campo si chiama in modo diverso da tabella a tabella.
        const riga = await apiGet<Versionata>(`/${tipo}/${id}`, token)
        const campo =
          tipo === 'codifiche-addebito' || tipo === 'condizioni-pagamento' ? 'attiva' : 'attivo'
        await apiPatch(`/${tipo}/${id}`, { [campo]: false, versione: riga.versione }, token)
      } catch (e) {
        errori.push(`${tipo}/${id}: ${(e as Error).message}`)
      }
    }
    expect(errori, 'pulizia dei dati creati dallo spec').toEqual([])
  })

  test.beforeEach(async ({ page, context }) => {
    await loginAndSaveState(page, context, 'admin')
  })

  test('elenco 001 predefinito', async ({ page }) => {
    await apriListino(page, d.ids.A, d.numeroA)
    await expect(pagina(page).getByTestId('listino-stato')).toContainText('Attivo')

    await pagina(page).getByTestId('listino-nuovo-elenco').click()
    const dlg = dialogo(page, 'Nuovo elenco')
    await expect(dlg).toBeVisible()
    // Il codice lo propone il server (prima lettura del dialog): si attende che compaia.
    await expect(dlg.getByLabel('Codice', { exact: true })).toHaveValue('001', {
      timeout: ATTESA_SERVER,
    })
    await dlg.getByLabel('Descrizione', { exact: true }).fill('Listino di prova')
    await dlg.getByLabel('Elenco predefinito').check()
    await cliccaEChiudi(page, dlg.getByTestId('listino-elenco-salva'), dlg)

    await expect(
      pagina(page).getByRole('heading', { level: 2, name: /^Elenco 001 - / })
    ).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(pagina(page).getByText('Predefinito', { exact: true })).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await expect(pagina(page).getByText('Nessuna riga.')).toBeVisible({ timeout: ATTESA_SERVER })
  })

  test('riga CER a peso netto con prezzo speciale tipo A a tre fasce', async ({ page }) => {
    await apriListino(page, d.ids.A, d.numeroA)
    await scegliElenco(page)
    const dlg = await apriNuovaRiga(page)

    await cercaESeleziona(dlg, CER, new RegExp(`^CER ${CER} - `))
    await expect(dlg.getByTestId('riga-scelta')).toContainText(CER)
    await expect(dlg.getByTestId('riga-tipo')).toHaveValue('CER')

    await dlg.getByTestId('riga-tipo-quantita').selectOption('PESO_NETTO')
    await dlg.getByTestId('riga-unita').fill('KG')
    await scegliVoce(dlg.getByLabel('Codice IVA', { exact: true }), 'IVA 22')
    await dlg.getByTestId('riga-prezzo-speciale').check()
    await expect(dlg.getByTestId('riga-sezione-fasce')).toBeVisible()
    await dlg.getByTestId('riga-applica-a').selectOption('DOCUMENTO')

    // Tre fasce (fino a 100, 500 e 1000 kg) piu' la fascia "oltre": tipo di calcolo A.
    for (const [n, fino, prezzo] of [
      [1, '100', '0,50'],
      [2, '500', '0,40'],
      [3, '1000', '0,30'],
    ] as const) {
      if (n > 1) {
        // Un click arrivato mentre la tabella si rilegge dal form va perso: si ripete finche' la
        // fascia c'e' (e non si aggiunge mai una fascia in piu').
        const fascia = dlg.getByTestId(`fascia-${n}-fino`)
        await expect(async () => {
          if ((await fascia.count()) === 0)
            await dlg.getByRole('button', { name: 'Aggiungi fascia' }).click()
          await expect(fascia).toBeVisible({ timeout: 2_000 })
        }).toPass({ timeout: 20_000 })
      }
      await dlg.getByTestId(`fascia-${n}-fino`).fill(fino)
      await dlg.getByTestId(`fascia-${n}-prezzo`).fill(prezzo)
      await dlg.getByTestId(`fascia-${n}-tipo`).selectOption('A')
    }
    await dlg.getByTestId('fascia-oltre-prezzo').fill('0,20')

    await salvaRiga(page, dlg)
    const riga = rigaDi(page, CER)
    await expect(riga).toContainText('CER', { timeout: ATTESA_SERVER })
    await expect(riga).toContainText('speciale')
  })

  test("riga V dall'archivio: il prezzo viene dal listino 2 del cliente", async ({ page }) => {
    await apriListinoElenco(page)
    const dlg = await apriNuovaRiga(page)

    await cercaESeleziona(dlg, d.addebitoV, new RegExp(`${d.codiceV} - .*\\(V\\)$`))
    await expect(dlg.getByTestId('riga-scelta')).toContainText(d.codiceV)
    await expect(dlg.getByTestId('riga-tipo')).toHaveValue('V')
    // Il cliente ha il listino 2 (10,00); il listino 1 varrebbe 5,00.
    await expect(dlg.getByTestId('riga-prezzo')).toHaveValue(/^10$/, { timeout: ATTESA_SERVER })
    await attendiProposta(dlg)
    await dlg.getByTestId('riga-tipo-quantita').selectOption('UNO')

    await salvaRiga(page, dlg)
    const riga = rigaDi(page, d.codiceV)
    await expect(riga).toContainText('V', { timeout: ATTESA_SERVER })
    await expect(riga).toContainText('10,00')
  })

  test('riga F trimestrale con il calendario automatico', async ({ page }) => {
    await apriListinoElenco(page)
    const dlg = await apriNuovaRiga(page)

    await cercaESeleziona(dlg, d.addebitoF, new RegExp(`${d.codiceF} - .*\\(F\\)$`))
    await expect(dlg.getByTestId('riga-tipo')).toHaveValue('F')
    await expect(dlg.getByTestId('riga-prezzo')).toHaveValue(/^100$/, { timeout: ATTESA_SERVER })
    await attendiProposta(dlg)
    await dlg.getByTestId('riga-periodo-scadenze').selectOption('TP')

    // Prima scadenza 15/03 di ogni anno, frequenza trimestrale: 15/03, 15/06, 15/09 e 15/12.
    await dlg.getByTestId('scadenza-1-giorno').fill('15')
    await dlg.getByTestId('scadenza-1-mese').fill('3')
    await dlg.getByTestId('scadenze-frequenza').selectOption('TRIMESTRALE')
    await dlg.getByRole('button', { name: 'Calendario automatico' }).click()
    await expect(dlg.getByTestId('scadenza-4-mese')).toHaveValue('12')
    await expect(dlg.getByTestId('scadenza-4-giorno')).toHaveValue('15')
    await expect(dlg.getByTestId('scadenza-5-mese')).toHaveCount(0)
    await expect(dlg.getByTestId('scadenze-errore-calendario')).toHaveCount(0)
    await expect(dlg.getByTestId('scadenze-totale-importo')).toContainText('400,00')

    await salvaRiga(page, dlg)
    const riga = rigaDi(page, d.codiceF)
    await expect(riga).toContainText('F', { timeout: ATTESA_SERVER })
    await expect(pagina(page).getByTestId('listino-totale-fissi')).toContainText('400,00', {
      timeout: ATTESA_SERVER,
    })
  })

  test('riga MW e un secondo MW rifiutato', async ({ page }) => {
    await apriListinoElenco(page)
    let dlg = await apriNuovaRiga(page)
    await cercaESeleziona(dlg, d.addebitoMw, new RegExp(`${d.codiceMw} - .*\\(MW\\)$`))
    await expect(dlg.getByTestId('riga-tipo')).toHaveValue('MW')
    await attendiProposta(dlg)
    await salvaRiga(page, dlg)
    await expect(rigaDi(page, d.codiceMw)).toContainText('MW', { timeout: ATTESA_SERVER })

    // Nel contratto c'e' gia' un minimo: il secondo MW (un altro addebito) e' rifiutato dal
    // backend e il dialog resta aperto con il suo messaggio.
    dlg = await apriNuovaRiga(page)
    await cercaESeleziona(dlg, d.addebitoMw2, new RegExp(`${d.codiceMw2} - .*\\(MW\\)$`))
    await expect(dlg.getByTestId('riga-tipo')).toHaveValue('MW')
    await attendiProposta(dlg)
    await expect(dlg.getByTestId('riga-salva')).toBeEnabled({ timeout: ATTESA_SERVER })
    await cliccaEAttendi(page, dlg.getByTestId('riga-salva'), { stato: [400, 409, 422] })
    await expect(dlg).toContainText('Nel contratto c’è già un addebito di minimo fatturabile.', {
      timeout: ATTESA_SERVER,
    })
    await expect(dlg).toBeVisible()
    await dlg.getByTestId('riga-annulla').click()
    await expect(dlg).toBeHidden({ timeout: ATTESA_SERVER })
    await expect(rigaDi(page, d.codiceMw2)).toHaveCount(0)
  })

  test("copia l'elenco sul contratto B: l'esito dice che il minimo non si copia", async ({
    page,
  }) => {
    await apriListino(page, d.ids.B, d.numeroB)
    // B non ha ancora elenchi: si crea il 001, poi si sostituiscono le sue righe con quelle di A.
    await pagina(page).getByTestId('listino-nuovo-elenco').click()
    const nuovo = dialogo(page, 'Nuovo elenco')
    await expect(nuovo.getByLabel('Codice', { exact: true })).toHaveValue('001', {
      timeout: ATTESA_SERVER,
    })
    await nuovo.getByLabel('Descrizione', { exact: true }).fill('Copia di prova')
    await cliccaEChiudi(page, nuovo.getByTestId('listino-elenco-salva'), nuovo)
    await expect(
      pagina(page).getByRole('heading', { level: 2, name: /^Elenco 001 - / })
    ).toBeVisible({ timeout: ATTESA_SERVER })

    await pagina(page).getByTestId('listino-copia').click()
    const dlg = dialogo(page, 'Copia da un altro elenco')
    await expect(dlg).toBeVisible()
    await sceltaClienteDiOrigine(page, dlg)
    await scegliVoce(dlg.getByTestId('copia-origine-contratto'), d.numeroA)
    await scegliVoce(dlg.getByTestId('copia-origine-elenco'), '001')
    await dlg.getByTestId('copia-avanti').click()
    await expect(dlg.getByTestId('copia-conferma')).toContainText('sostituite')
    await cliccaEAttendi(page, dlg.getByTestId('copia-conferma-finale'))

    // Tre righe copiate (CER, V, F); il minimo (MW) resta fuori.
    await expect(dlg.getByTestId('copia-esito')).toContainText('Righe copiate: 3.', {
      timeout: ATTESA_SERVER,
    })
    await expect(dlg.getByTestId('copia-escluse')).toContainText('1 minimi')
    await dlg.getByTestId('copia-chiudi').click()
    await expect(dlg).toBeHidden({ timeout: ATTESA_SERVER })
    await expect(rigaDi(page, CER)).toHaveCount(1, { timeout: ATTESA_SERVER })
    await expect(rigaDi(page, d.codiceV)).toHaveCount(1)
    await expect(rigaDi(page, d.codiceF)).toHaveCount(1)
    await expect(rigaDi(page, d.codiceMw)).toHaveCount(0)
  })

  test('provvigione 5 % su tutto il contratto A', async ({ page }) => {
    await apriListinoElenco(page)
    await pagina(page).getByRole('button', { name: 'Provvigioni e sconti' }).click()
    const dlg = dialogo(page, 'Provvigioni e sconti del contratto')
    await expect(dlg).toBeVisible()
    await expect(dlg.getByTestId('ps-avviso')).toContainText('prezzo speciale')
    await dlg.getByTestId('ps-azione-provvigione').check()
    await dlg.getByTestId('ps-provvigione').fill('5')
    await dlg.getByRole('button', { name: 'Avanti' }).click()
    await expect(dlg.getByTestId('ps-conferma')).toBeVisible()
    await cliccaEAttendi(page, dlg.getByRole('button', { name: 'Applica' }))

    // La riga CER ha il prezzo speciale: non si tocca e il conteggio lo dice.
    await expect(dlg.getByTestId('ps-esito')).toContainText('Righe aggiornate:', {
      timeout: ATTESA_SERVER,
    })
    await expect(dlg.getByTestId('ps-esito-speciali')).toContainText('1')
    await dlg.getByTestId('ps-chiudi').click()
    await expect(dlg).toBeHidden({ timeout: ATTESA_SERVER })

    const righe = await righeApi(d.ids.A)
    expect(righe.find(r => r.addebito?.codice === d.codiceV)?.provvigione).toBe('5')
    expect(righe.find(r => r.cerCode === CER)?.provvigione ?? null).toBeNull()
  })

  test('modifica automatica dei prezzi +3 % sul CER: anteprima e conferma', async ({ page }) => {
    await page.goto('/contratti-clienti')
    await expect(
      pagina(page).getByRole('heading', { level: 1, name: 'Contratti clienti' })
    ).toBeVisible()
    const filtrato = attendiElenco(page, /\/contratti-clienti$/)
    await pagina(page).getByRole('searchbox', { name: 'Cerca un contratto' }).fill(d.numeroA)
    await filtrato
    // La variazione riguarda solo il contratto scelto nella lista (R51).
    await pagina(page).getByTestId(`contratti-scegli-${d.ids.A}`).check()
    await expect(pagina(page).getByTestId('contratti-scelti')).toContainText('1 contratto scelto')
    await pagina(page).getByRole('button', { name: 'Variazioni prezzi' }).click()
    await page.getByRole('menuitem', { name: 'Modifica automatica dei prezzi' }).click()

    const dlg = dialogo(page, 'Modifica automatica dei prezzi')
    await expect(dlg).toBeVisible()
    await expect(dlg.getByTestId('vp-errore-caricamento')).toHaveCount(0)
    await dlg.getByTestId('vp-tipo').selectOption('AUMENTO_PERCENTUALE')
    await dlg.getByTestId('vp-valore').fill('3')
    await expect(dlg.getByTestId('vp-contratti-scelti')).toBeChecked()
    await dlg.getByTestId('vp-cer').fill(CER)
    await cliccaEAttendi(page, dlg.getByRole('button', { name: 'Anteprima' }))

    // Anteprima: solo prezzi del CER del contratto A (le fasce del prezzo speciale).
    await expect(dlg.getByTestId('anteprima-righe')).toBeVisible({ timeout: ATTESA_SERVER })
    const righe = dlg.getByTestId('anteprima-righe').locator('tbody tr')
    await expect(righe.first()).toContainText(d.numeroA)
    await expect(righe.first()).toContainText(CER)
    for (const testo of await righe.allInnerTexts()) {
      expect(testo, 'ogni riga dell anteprima e del contratto A').toContain(d.numeroA)
    }

    await dlg.getByRole('button', { name: 'Applica' }).click()
    await expect(dlg.getByTestId('vp-riepilogo')).toContainText('Stai per modificare i prezzi')
    await cliccaEAttendi(page, dlg.getByRole('button', { name: 'Conferma la variazione' }))
    await expect(dlg.getByTestId('vp-esito')).toContainText(/Prezzi aggiornati: [1-9]/, {
      timeout: ATTESA_SERVER,
    })
    await dlg.getByRole('button', { name: 'Chiudi' }).click()
    await expect(dlg).toBeHidden({ timeout: ATTESA_SERVER })

    const dopo = await righeApi(d.ids.A)
    const cer = dopo.find(r => r.cerCode === CER)
    expect(cer?.scaglioni?.[0]?.prezzo, "la prima fascia del CER e' salita").not.toBe('0.50')
    // Il V non e' un CER: il prezzo resta quello del listino 2.
    expect(dopo.find(r => r.addebito?.codice === d.codiceV)?.prezzo).toBe('10.00')
  })

  test('adeguamento ISTAT sul contratto B, in un mese libero di un anno vecchio', async ({
    page,
  }) => {
    await apriContratti(page)
    await pagina(page).getByRole('button', { name: 'Variazioni prezzi' }).click()
    await page.getByRole('menuitem', { name: 'Adeguamento ISTAT' }).click()

    const dlg = dialogo(page, 'Adeguamento ISTAT')
    await expect(dlg).toBeVisible()
    // Il mese di B (scelto libero: nessun altro contratto dell'azienda ci inizia col flag).
    const chiave = `${d.annoIstat}-${d.meseIstat}`
    const percentuale = dlg.getByTestId(`istat-perc-${chiave}`)
    await expect(percentuale).toBeVisible({ timeout: ATTESA_SERVER })
    await percentuale.fill('2,5')
    await dlg.getByTestId('istat-tipo-V').check()
    await cliccaEAttendi(page, dlg.getByRole('button', { name: 'Anteprima' }))

    await expect(dlg.getByTestId('anteprima-righe')).toBeVisible({ timeout: ATTESA_SERVER })
    const righe = dlg.getByTestId('anteprima-righe').locator('tbody tr')
    await expect(righe).toHaveCount(1)
    await expect(righe.first()).toContainText(d.numeroB)
    await expect(righe.first()).toContainText('10,00')
    await expect(righe.first()).toContainText('10,25')

    await dlg.getByRole('button', { name: 'Applica' }).click()
    await expect(dlg.getByTestId('istat-riepilogo')).toContainText('2,5 %')
    await cliccaEAttendi(page, dlg.getByRole('button', { name: "Conferma l'adeguamento" }))
    await expect(dlg.getByTestId('istat-esito')).toContainText('Prezzi aggiornati: 1', {
      timeout: ATTESA_SERVER,
    })
    await dlg.getByRole('button', { name: 'Chiudi' }).click()
    await expect(dlg).toBeHidden({ timeout: ATTESA_SERVER })

    const dopo = await righeApi(d.ids.B)
    expect(dopo.find(r => r.addebito?.codice === d.codiceV)?.prezzo).toBe('10.25')
    // Il contratto A non ha il flag: il suo V resta a 10.
    expect((await righeApi(d.ids.A)).find(r => r.addebito?.codice === d.codiceV)?.prezzo).toBe(
      '10.00'
    )
  })

  test("allegare il contratto A al contratto C e' rifiutato: tipo diverso da T", async ({
    page,
  }) => {
    await apriContratti(page, d.numeroA)
    await pagina(page).getByTestId(`contratti-modifica-${d.ids.A}`).click()
    const dlg = dialogo(page, 'Modifica contratto')
    await expect(dlg).toBeVisible()
    await expect(dlg.getByText('Caricamento…')).toBeHidden({ timeout: ATTESA_SERVER })

    // Il contratto C e' dello stesso cliente: compare fra i possibili principali.
    await scegliVoce(dlg.getByTestId('contratto-dlg-principale'), d.numeroC)
    await expect(dlg.getByTestId('contratto-dlg-salva')).toBeEnabled({ timeout: ATTESA_SERVER })
    await cliccaEAttendi(page, dlg.getByTestId('contratto-dlg-salva'), { stato: [400, 409, 422] })
    await expect(dlg.getByTestId('contratto-dlg-errore')).toContainText(
      'Questo contratto ha addebiti di tipo diverso da T: non può essere allegato a un altro.',
      { timeout: ATTESA_SERVER }
    )
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: 'Annulla', exact: true }).click()
    await expect(dlg).toBeHidden({ timeout: ATTESA_SERVER })
  })

  test('annulla il contratto A: il listino diventa di sola lettura', async ({ page }) => {
    await apriContratti(page, d.numeroA)
    const riga = pagina(page).getByTestId(`contratti-riga-${d.ids.A}`)
    await riga.getByRole('button', { name: `Annulla il contratto ${d.numeroA}` }).click()
    const annullo = dialogo(page, new RegExp(`Annulla il contratto ${d.numeroA}`))
    await expect(annullo).toBeVisible()
    await annullo.getByTestId('annullo-testo').fill('Prova e2e del listino')
    await cliccaEChiudi(page, annullo.getByTestId('annullo-conferma').getByRole('button'), annullo)
    await expect(riga).toContainText('Annullato', { timeout: ATTESA_SERVER })

    await pagina(page).getByTestId(`contratti-listino-${d.ids.A}`).click()
    await expect(
      pagina(page).getByRole('heading', { level: 1, name: `Listino del contratto ${d.numeroA}` })
    ).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(pagina(page).getByTestId('listino-stato')).toContainText('Annullato')
    await expect(pagina(page).getByTestId('listino-sola-lettura')).toContainText(
      'Il listino di un contratto annullato non si modifica.'
    )
    await scegliElenco(page)
    await expect(rigaDi(page, CER)).toHaveCount(1, { timeout: ATTESA_SERVER })
    await soloLettura(page)
  })

  test('VIEWER: legge il listino senza pulsanti di scrittura', async ({ page, context }) => {
    test.skip(!hasRoleCredentials('viewer'), skipReason('viewer'))
    // B ha l'elenco 001 con le righe copiate: il VIEWER lo legge, non puo' scrivere nulla.
    expect(
      (await righeApi(d.ids.B)).length,
      'precondizione: B ha le righe copiate'
    ).toBeGreaterThan(0)
    await loginAndSaveState(page, context, 'viewer')

    await apriContratti(page, d.numeroB)
    await expect(pagina(page).getByRole('button', { name: 'Variazioni prezzi' })).toHaveCount(0)
    await expect(pagina(page).getByTestId('contratti-nuovo')).toHaveCount(0)
    await pagina(page).getByTestId(`contratti-listino-${d.ids.B}`).click()
    await expect(
      pagina(page).getByRole('heading', { level: 1, name: `Listino del contratto ${d.numeroB}` })
    ).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(pagina(page).getByTestId('listino-sola-lettura')).toContainText(
      'Hai accesso in sola lettura.'
    )
    await scegliElenco(page)
    await expect(rigaDi(page, CER)).toHaveCount(1, { timeout: ATTESA_SERVER })
    await soloLettura(page)
  })
})

/** Apre il listino di un contratto dalla lista dei contratti (non con `goto` diretto). */
async function apriListino(page: Page, id: string, numero: string): Promise<void> {
  await page.goto('/contratti-clienti')
  await expect(
    pagina(page).getByRole('heading', { level: 1, name: 'Contratti clienti' })
  ).toBeVisible()
  const filtrato = attendiElenco(page, /\/contratti-clienti$/)
  await pagina(page).getByRole('searchbox', { name: 'Cerca un contratto' }).fill(numero)
  await filtrato
  await pagina(page).getByTestId(`contratti-listino-${id}`).click()
  await expect(
    pagina(page).getByRole('heading', { level: 1, name: `Listino del contratto ${numero}` })
  ).toBeVisible({ timeout: ATTESA_SERVER })
}

async function scegliElenco(page: Page): Promise<void> {
  // Un solo elenco: si apre dal pannello (la pagina non ne sceglie uno da sola).
  await pagina(page).getByRole('button', { name: /^001 / }).click()
  await expect(pagina(page).getByRole('heading', { level: 2, name: /^Elenco 001 - / })).toBeVisible(
    {
      timeout: ATTESA_SERVER,
    }
  )
}

/** Sceglie in un `<select>` nativo la voce il cui testo contiene `testo`. */
async function scegliVoce(select: Locator, testo: string): Promise<void> {
  await expect(select.locator('option', { hasText: testo }).first()).toBeAttached({
    timeout: ATTESA_SERVER,
  })
  const valore = await select.locator('option', { hasText: testo }).first().getAttribute('value')
  expect(valore, `voce "${testo}" assente dal campo`).toBeTruthy()
  await select.selectOption(valore!)
}

async function apriNuovaRiga(page: Page): Promise<Locator> {
  await pagina(page).getByTestId('listino-nuova-riga').click()
  const dlg = dialogo(page, 'Nuova riga')
  await expect(dlg).toBeVisible()
  // Le opzioni (IVA, categorie, centri) arrivano dal server dopo l'apertura.
  await expect(dlg.getByLabel('Codice IVA', { exact: true }).locator('option')).not.toHaveCount(1, {
    timeout: ATTESA_SERVER,
  })
  return dlg
}

/** Cerca nel campo "CER o addebito" e sceglie la voce dai risultati (la ricerca e' ritardata). */
async function cercaESeleziona(dlg: Locator, testo: string, voce: RegExp): Promise<void> {
  await dlg.getByTestId('riga-ricerca').fill(testo)
  const bottone = dlg.getByTestId('riga-ricerca-risultati').getByRole('button', { name: voce })
  await expect(bottone).toBeVisible({ timeout: ATTESA_SERVER })
  await bottone.click()
}

async function salvaRiga(page: Page, dlg: Locator): Promise<void> {
  await cliccaEChiudi(page, dlg.getByTestId('riga-salva'), dlg)
}

/** La riga della tavola con quel CER o codice di addebito. */
function rigaDi(page: Page, chiave: string): Locator {
  return pagina(page).locator('tr[data-testid^="listino-riga-"]').filter({ hasText: chiave })
}

/** Apre il listino del contratto A e ne sceglie l'elenco 001. */
async function apriListinoElenco(page: Page): Promise<void> {
  await apriListino(page, d.ids.A, d.numeroA)
  await scegliElenco(page)
}

/** Sceglie il cliente del test nel campo "Cliente di origine" (ricerca per testo, poi l'opzione). */
async function sceltaClienteDiOrigine(page: Page, dlg: Locator): Promise<void> {
  const campo = dlg.getByRole('combobox', { name: 'Cliente di origine' })
  await expect(campo).toBeEnabled({ timeout: ATTESA_SERVER })
  const ricerca = page.waitForResponse(
    r =>
      r.request().method() === 'GET' &&
      new URL(r.url()).pathname.endsWith('/clienti') &&
      new URL(r.url()).searchParams.get('testo') === d.cliente,
    { timeout: ATTESA_SERVER }
  )
  ricerca.catch(() => undefined)
  await campo.fill(d.cliente)
  expect((await ricerca).ok(), 'ricerca del cliente per testo').toBe(true)
  await page.getByRole('option', { name: new RegExp(d.cliente) }).click({ timeout: ATTESA_SERVER })
  await expect(campo).toHaveValue(new RegExp(d.cliente), { timeout: ATTESA_SERVER })
}

interface RigaApi {
  id: string
  tipo: string
  cerCode: string | null
  addebito: { codice: string } | null
  prezzo: string | null
  provvigione: string | null
  scaglioni?: { ordine: number; prezzo: string }[]
}

/** Le righe di tutti gli elenchi di un contratto, lette via API. */
async function righeApi(contrattoId: string): Promise<RigaApi[]> {
  const token = await apiLogin('admin')
  const { elenchi } = await apiGet<{ elenchi: { id: string }[] }>(
    `/contratti-clienti/${contrattoId}/elenchi`,
    token
  )
  const righe: RigaApi[] = []
  for (const e of elenchi)
    righe.push(...(await apiGet<RigaApi[]>(`/elenchi-addebiti/${e.id}/righe`, token)))
  return righe
}

/** Nessun pulsante di scrittura nel listino: elenchi, righe, copia e azioni di massa. */
async function soloLettura(page: Page): Promise<void> {
  const p = pagina(page)
  await expect(p.getByTestId('listino-nuovo-elenco')).toHaveCount(0)
  await expect(p.getByTestId('listino-nuova-riga')).toHaveCount(0)
  await expect(p.getByTestId('listino-copia')).toHaveCount(0)
  await expect(p.getByTestId('listino-aggiungi-righe')).toHaveCount(0)
  await expect(p.getByTestId('listino-provvigioni-sconti')).toHaveCount(0)
  await expect(p.getByRole('button', { name: /^(Modifica|Elimina) l.elenco/ })).toHaveCount(0)
}

/** Lista dei contratti, filtrata per numero se dato (la lista e' paginata e conserva le run vecchie). */
async function apriContratti(page: Page, numero?: string): Promise<void> {
  await page.goto('/contratti-clienti')
  await expect(
    pagina(page).getByRole('heading', { level: 1, name: 'Contratti clienti' })
  ).toBeVisible()
  if (!numero) return
  const filtrato = attendiElenco(page, /\/contratti-clienti$/)
  await pagina(page).getByRole('searchbox', { name: 'Cerca un contratto' }).fill(numero)
  await filtrato
  await expect(pagina(page).getByRole('row', { name: new RegExp(numero) })).toHaveCount(1, {
    timeout: ATTESA_SERVER,
  })
}

/** Attende la proposta del backend (unita', prezzo e codice IVA) prima di salvare: su un runner lento arriva dopo la scelta. */
async function attendiProposta(dlg: Locator): Promise<void> {
  await expect(dlg.getByTestId('riga-unita')).not.toHaveValue('', { timeout: ATTESA_SERVER })
  await expect(dlg.getByTestId('riga-prezzo')).not.toHaveValue('', { timeout: ATTESA_SERVER })
  await expect(dlg.getByLabel('Codice IVA', { exact: true })).not.toHaveValue('', {
    timeout: ATTESA_SERVER,
  })
}
