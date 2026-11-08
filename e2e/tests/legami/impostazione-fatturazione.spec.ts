import { test, expect } from '@playwright/test'
import type { PrismaClient } from '@prisma/client'
import { getApiUrl } from '../../utils/env'
import { apiGet, apiPost } from '../../utils/api-client'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { partitaIvaCasualeValida } from '../../utils/partita-iva'
import { conPrefissoUnico } from '../../utils/run-id'
import { ATTESA_SERVER, attendiRisposta } from '../../utils/attese'

/**
 * E2E — Impostazione «Fatturazione da» e flag `fatturabile` (pezzo 4.3a, Task 9).
 *
 * In 4.3a nessun legame si crea ancora: lo spec verifica l'impostazione (API e schermata), il
 * flag sulle causali e, soprattutto, l'ASSENZA di comportamento nuovo nel registro e nel listino.
 *
 *   1. ADMIN imposta la data via API (e la legge); data non valida = 400.
 *   2. ADMIN la imposta dalla schermata «Fatturazione da» e la spegne.
 *   3. OPERATOR riceve 403 sulla scrittura (la lettura resta aperta).
 *   4. ADMIN crea una causale aziendale fatturabile (la gestione la riporta).
 *   5. Una registrazione con INGRESSO_ESTERNO (fatturabile di sistema) NON crea legami: nessuna
 *      riga in `legami_movimento` / `righe_legame_movimento`, nessuna rotta del legame.
 *   6. Una riga di listino senza legami si elimina.
 *
 * Isolamento: lo spec lavora in un'AZIENDA DI TEST PROPRIA creata in `beforeAll` (l'azienda seed
 * condivisa ha esaurito i 99 codici dei registri IVA nel database locale che dura nel tempo);
 * i dati si creano via API con nomi casuali; la pulizia e' per id
 * esatti. L'impostazione e' unica per azienda: lo spec la riporta al valore di partenza in
 * `afterAll`. Le date di impostazione sono nel 2099 e il movimento del test 5 e' di oggi, cosi' nessun movimento viene "toccato".
 * Il movimento registrato dal test 5 NON si puo' cancellare (il registro e' a catena di hash):
 * resta, riconoscibile dalla controparte con il prefisso della run.
 */

interface Versionata {
  id: string
  versione: number
}

interface Impostazione {
  fatturazioneDa: string | null
  versione: number
  modificatoIl: string | null
}

interface Risposta<T = unknown> {
  stato: number
  corpo: T
}

interface Creato {
  tipo: string
  id: string
}

const DATA_A = '2099-03-01'
const DATA_B = '2099-06-30'

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function codiceCasuale(n: number): string {
  let c = ''
  while (c.length < n) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)]
  return c
}

/** Chiamata API che restituisce stato e corpo senza lanciare: serve per leggere 403/404/409. */
async function chiama<T = unknown>(
  metodo: string,
  percorso: string,
  token: string,
  corpo?: unknown
): Promise<Risposta<T>> {
  const r = await fetch(`${getApiUrl()}${percorso}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const testo = await r.text()
  let json: unknown = testo
  try {
    json = testo ? JSON.parse(testo) : null
  } catch {
    /* corpo non JSON: resta il testo */
  }
  return { stato: r.status, corpo: json as T }
}

/** Imposta la data, confermando i movimenti toccati se il server li segnala. */
async function impostaConConferma(
  token: string,
  fatturazioneDa: string | null
): Promise<Impostazione> {
  const attuale = await apiGet<Impostazione>('/impostazioni-fatturazione', token)
  let r = await chiama<Impostazione & { details?: { movimentiToccati?: number } }>(
    'PUT',
    '/impostazioni-fatturazione',
    token,
    { fatturazioneDa, versione: attuale.versione }
  )
  if (r.stato === 409) {
    const toccati = (r.corpo as { details?: { movimentiToccati?: number } }).details
      ?.movimentiToccati
    if (typeof toccati === 'number') {
      r = await chiama('PUT', '/impostazioni-fatturazione', token, {
        fatturazioneDa,
        versione: attuale.versione,
        confermaMovimenti: toccati,
      })
    }
  }
  expect(r.stato, `PUT /impostazioni-fatturazione: ${JSON.stringify(r.corpo)}`).toBe(200)
  return r.corpo as Impostazione
}

/** Connessione al database locale: crea l'azienda di test e conta i legami (nessuna rotta li espone). */
const dbLocale = clientDbLocale()
/** Azienda di test propria dello spec (vedi utils/azienda-di-test.ts), creata in `beforeAll`. */
let azienda: AziendaDiTest

/**
 * Legami (e righe) che hanno per radice il movimento dato. Il conteggio e` per movimento e non
 * globale: dalla 4.3b altri spec (e il registro di altre aziende) creano legami in parallelo.
 */
async function contaLegamiDelMovimento(db: PrismaClient, movimentoId: string): Promise<number> {
  const r = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT (SELECT count(*) FROM legami_movimento WHERE movimento_originale_id = $1::uuid)
          + (SELECT count(*) FROM righe_legame_movimento r
               JOIN legami_movimento l ON l.id = r.legame_id
              WHERE l.movimento_originale_id = $1::uuid) AS n`,
    movimentoId
  )
  return Number(r[0].n)
}

const d = {
  iniziale: null as Impostazione | null,
  causale: '',
  contrattoId: '',
  elencoId: '',
  rigaId: '',
}
let creati: Creato[] = []
let idCausale = ''

test.describe('Impostazione fatturazione e fatturabile — 4.3a', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(
    dbLocale === null,
    'Serve un database locale (DATABASE_URL su localhost) per creare l’azienda di test dedicata'
  )

  test.beforeAll(async () => {
    if (!dbLocale) return
    creati = []
    idCausale = ''
    azienda = await creaAziendaDiTest(dbLocale, 'impostazione fatturazione')
    const token = await tokenAzienda(azienda, 'admin')
    d.iniziale = await apiGet<Impostazione>('/impostazioni-fatturazione', token)
    d.causale = `AZ_E2E_${codiceCasuale(8)}`

    // Dati del test 6: cliente, contratto (bozza), elenco con una riga a prezzo fisso.
    const crea = async <T extends Versionata>(tipo: string, corpo: unknown): Promise<T> => {
      const r = await apiPost<Record<string, unknown>>(`/${tipo}`, corpo, token)
      const riga = (
        'id' in r ? r : Object.values(r).find(v => typeof v === 'object' && v !== null && 'id' in v)
      ) as T
      creati.push({ tipo, id: riga.id })
      return riga
    }
    const registriEsistenti = new Set(
      (await apiGet<{ codice: string }[]>('/registri-iva?incluseDisattivate=true', token)).map(
        r => r.codice
      )
    )
    const liberi = Array.from({ length: 99 }, (_, n) => String(n + 1).padStart(2, '0')).filter(
      c => !registriEsistenti.has(c)
    )
    if (liberi.length === 0) throw new Error('Nessun codice di registro IVA libero (01-99).')
    const registro = await crea<Versionata>('registri-iva', {
      codice: liberi[Math.floor(Math.random() * liberi.length)],
      descrizione: conPrefissoUnico('Registro'),
      ricevuteSplit: false,
    })
    const condizione = await crea<Versionata>('condizioni-pagamento', {
      codice: codiceCasuale(8),
      descrizione: conPrefissoUnico('Condizione'),
      modalita: 'MP05',
      giorniRate: [30],
      fineMese: false,
    })
    const cliente = await crea<Versionata>('clienti', {
      ragioneSociale: conPrefissoUnico('Cliente fatturazione'),
      partitaIva: partitaIvaCasualeValida(),
      indirizzo: {
        via: 'Via delle Prove',
        civico: '7',
        cap: '20100',
        comune: 'Milano',
        provincia: 'MI',
      },
      listino: 2,
    })
    const gruppo = await crea<Versionata>('codifiche-addebito', {
      genere: 'GRUPPO',
      descrizione: conPrefissoUnico('Gruppo'),
    })
    const iva = await crea<Versionata>('codici-iva', {
      codice: codiceCasuale(3),
      descrizione: conPrefissoUnico('IVA 22'),
      aliquota: '22',
    })
    const addebito = await crea<Versionata>('addebiti', {
      descrizione: conPrefissoUnico('Servizio V'),
      gruppoId: gruppo.id,
      unitaMisura: 'NR',
      codiceIvaId: iva.id,
      tipo: 'V',
      listini: [{ numero: 2, prezzo: '10.00' }],
    })
    const contratto = await crea<Versionata>('contratti-clienti', {
      numero: `F-${codiceCasuale(8)}`,
      descrizione: conPrefissoUnico('Contratto'),
      clienteId: cliente.id,
      dataInizio: '2026-01-01',
      condizionePagamentoId: condizione.id,
      registroIvaId: registro.id,
      incrementoIstat: false,
    })
    d.contrattoId = contratto.id
    // Attivo come negli altri spec del listino: a fine prova si annulla (un contratto con elenchi non si elimina).
    await chiama('PATCH', `/contratti-clienti/${contratto.id}/stato`, token, {
      stato: 'ATTIVO',
      versione: contratto.versione,
    })
    const elenco = await apiPost<Versionata>(
      `/contratti-clienti/${contratto.id}/elenchi`,
      { descrizione: conPrefissoUnico('Elenco'), predefinito: true },
      token
    )
    d.elencoId = elenco.id
    const riga = await apiPost<Versionata>(
      `/elenchi-addebiti/${elenco.id}/righe`,
      {
        tipo: 'V',
        addebitoId: addebito.id,
        tipoQuantita: 'UNO',
        unitaMisura: 'NR',
        codiceIvaId: iva.id,
        prezzo: '10.00',
      },
      token
    )
    d.rigaId = riga.id
  })

  test.afterAll(async () => {
    await dbLocale?.$disconnect()
    if (!azienda) return
    const token = await tokenAzienda(azienda, 'admin')
    const errori: string[] = []
    try {
      if (idCausale) await chiama('DELETE', `/registro/causali/aziendali/${idCausale}`, token)
    } catch (e) {
      errori.push(`causale: ${(e as Error).message}`)
    }
    for (const { tipo, id } of [...creati].reverse()) {
      try {
        let r = await chiama('DELETE', `/${tipo}/${id}`, token)
        if (r.stato < 400) continue
        // In uso: contratti si annullano, il resto si disattiva.
        const riga = await apiGet<Versionata & { stato?: string }>(`/${tipo}/${id}`, token)
        if (tipo === 'contratti-clienti') {
          r = await chiama('PATCH', `/${tipo}/${id}/stato`, token, {
            stato: 'ANNULLATO',
            versione: riga.versione,
            motivo: 'Pulizia della prova e2e',
          })
        } else {
          const campo =
            tipo === 'codifiche-addebito' || tipo === 'condizioni-pagamento' ? 'attiva' : 'attivo'
          r = await chiama('PATCH', `/${tipo}/${id}`, token, {
            [campo]: false,
            versione: riga.versione,
          })
        }
        if (r.stato >= 400) errori.push(`${tipo}/${id}: ${r.stato}`)
      } catch (e) {
        errori.push(`${tipo}/${id}: ${(e as Error).message}`)
      }
    }
    // Riporta l'impostazione al valore di partenza (una riga mai creata resta com'e').
    try {
      const ora = await apiGet<Impostazione>('/impostazioni-fatturazione', token)
      if (d.iniziale && ora.fatturazioneDa !== d.iniziale.fatturazioneDa) {
        await impostaConConferma(token, d.iniziale.fatturazioneDa)
      }
    } catch (e) {
      errori.push(`impostazione: ${(e as Error).message}`)
    }
    expect(errori, 'pulizia dei dati creati dallo spec').toEqual([])
  })

  test('ADMIN imposta la data via API', async () => {
    const token = await tokenAzienda(azienda, 'admin')
    const salvata = await impostaConConferma(token, DATA_A)
    expect(salvata.fatturazioneDa).toBe(DATA_A)
    expect(salvata.versione).toBeGreaterThanOrEqual(1)
    const letta = await apiGet<Impostazione>('/impostazioni-fatturazione', token)
    expect(letta.fatturazioneDa).toBe(DATA_A)
    expect(letta.versione).toBe(salvata.versione)

    // Versione vecchia: 409 e nulla cambia.
    const vecchia = await chiama('PUT', '/impostazioni-fatturazione', token, {
      fatturazioneDa: DATA_B,
      versione: salvata.versione - 1,
    })
    expect(vecchia.stato).toBe(409)
    // Data inesistente: 400.
    const errata = await chiama('PUT', '/impostazioni-fatturazione', token, {
      fatturazioneDa: '2099-02-30',
      versione: salvata.versione,
    })
    expect(errata.stato).toBe(400)
    expect((await apiGet<Impostazione>('/impostazioni-fatturazione', token)).fatturazioneDa).toBe(
      DATA_A
    )
  })

  test('ADMIN la cambia e la spegne dalla schermata «Fatturazione da»', async ({ page }) => {
    await accediUiComeAzienda(page, azienda, 'admin')
    await page.goto('/clienti/fatturazione')
    const pagina = page.locator('#main-content')
    await expect(
      pagina.getByRole('heading', { level: 1, name: 'Impostazioni di fatturazione' })
    ).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    // Il campo e' un calendario (`p-calendar`): si legge e si scrive come `gg/mm/aaaa`.
    const dataIt = (iso: string): string => iso.split('-').reverse().join('/')
    const campo = pagina.getByTestId('fatt-data').locator('input')
    await expect(campo).toHaveValue(dataIt(DATA_A), { timeout: ATTESA_SERVER })

    await campo.click()
    await campo.press('Control+A')
    await campo.pressSequentially(dataIt(DATA_B))
    // Il pannello del calendario si chiude cliccando fuori.
    await pagina.getByRole('heading', { level: 1 }).click()
    await expect(campo).toHaveValue(dataIt(DATA_B))
    await attendiRisposta(page, () => pagina.getByTestId('fatt-salva').click(), { metodo: 'PUT' })
    const token = await tokenAzienda(azienda, 'admin')
    expect((await apiGet<Impostazione>('/impostazioni-fatturazione', token)).fatturazioneDa).toBe(
      DATA_B
    )

    await attendiRisposta(page, () => pagina.getByTestId('fatt-spegni').click(), {
      metodo: 'PUT',
    })
    await expect(pagina.getByTestId('fatt-spenta')).toBeVisible({ timeout: ATTESA_SERVER })
    expect((await apiGet<Impostazione>('/impostazioni-fatturazione', token)).fatturazioneDa).toBe(
      null
    )
  })

  test('OPERATOR riceve 403 in scrittura e puo leggere', async () => {
    const admin = await tokenAzienda(azienda, 'admin')
    const prima = await apiGet<Impostazione>('/impostazioni-fatturazione', admin)
    const operatore = await tokenAzienda(azienda, 'operator')
    const lettura = await chiama<Impostazione>('GET', '/impostazioni-fatturazione', operatore)
    expect(lettura.stato).toBe(200)
    const scrittura = await chiama('PUT', '/impostazioni-fatturazione', operatore, {
      fatturazioneDa: DATA_A,
      versione: prima.versione,
    })
    expect(scrittura.stato).toBe(403)
    expect((await apiGet<Impostazione>('/impostazioni-fatturazione', admin)).versione).toBe(
      prima.versione
    )
  })

  test('ADMIN crea una causale aziendale fatturabile', async () => {
    const token = await tokenAzienda(azienda, 'admin')
    const r = await chiama<{ id: string; fatturabile: boolean }>(
      'POST',
      '/registro/causali/aziendali',
      token,
      {
        codice: d.causale,
        verso: 'CARICO',
        descrizione: conPrefissoUnico('Causale fatturabile'),
        ruoloMud: 'RICEVUTO_DA_TERZI',
        fatturabile: true,
      }
    )
    expect(r.stato, JSON.stringify(r.corpo)).toBe(201)
    idCausale = r.corpo.id
    expect(r.corpo.fatturabile).toBe(true)

    const gestione = await apiGet<{
      aziendali: { id: string; codice: string; fatturabile: boolean }[]
      sistema: { codice: string; verso: string; fatturabile: boolean }[]
    }>('/registro/causali/gestione', token)
    expect(gestione.aziendali.find(c => c.codice === d.causale)?.fatturabile).toBe(true)
    // Di sistema, solo INGRESSO_ESTERNO in carico e' fatturabile (decisione 15).
    const fatturabiliDiSistema = gestione.sistema.filter(c => c.fatturabile)
    expect(fatturabiliDiSistema.map(c => `${c.verso}:${c.codice}`)).toEqual([
      'CARICO:INGRESSO_ESTERNO',
    ])
  })

  test('un movimento con INGRESSO_ESTERNO non crea legami', async () => {
    const token = await tokenAzienda(azienda, 'admin')
    await chiama('POST', '/registro/registri/assicura', token)
    const r = await chiama<{ id: string }>('POST', '/registro', token, {
      type: 'CARICO',
      movementDate: '2026-11-03',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '15 01 01',
      quantity: 12.5,
      unit: 'KG',
      counterpartName: conPrefissoUnico('Controparte legami'),
    })
    expect(r.stato, JSON.stringify(r.corpo)).toBe(201)
    expect(r.corpo.id).toBeTruthy()

    // «Fatturazione da» e` nel 2099: il movimento non entra in fatturazione e non ha legame
    // (la rotta, dalla 4.3b, risponde 404 «legame non trovato»).
    const legame = await chiama('GET', `/registro/movimenti/${r.corpo.id}/legame`, token)
    expect(legame.stato).toBe(404)
    if (dbLocale) {
      expect(await contaLegamiDelMovimento(dbLocale, r.corpo.id)).toBe(0)
    }
  })

  test('una riga di listino senza legami si elimina', async () => {
    const token = await tokenAzienda(azienda, 'admin')
    const righe = await apiGet<(Versionata & { id: string })[]>(
      `/elenchi-addebiti/${d.elencoId}/righe`,
      token
    )
    const riga = righe.find(r => r.id === d.rigaId)
    expect(riga, 'precondizione: la riga creata esiste').toBeTruthy()
    const r = await chiama<{ avvisi: string[] }>(
      'DELETE',
      `/righe-addebito/${d.rigaId}?versione=${riga!.versione}`,
      token
    )
    expect(r.stato, JSON.stringify(r.corpo)).toBe(200)
    expect(r.corpo.avvisi).toEqual([])
    const dopo = await apiGet<{ id: string }[]>(`/elenchi-addebiti/${d.elencoId}/righe`, token)
    expect(dopo.find(x => x.id === d.rigaId)).toBeUndefined()
  })
})
