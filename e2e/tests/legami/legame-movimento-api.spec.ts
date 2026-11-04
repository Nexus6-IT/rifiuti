import { test, expect } from '@playwright/test'
import { getApiUrl } from '../../utils/env'
import { clientDbLocale, creaAziendaDiTest } from '../../utils/azienda-di-test'
import { devLoginTokens } from '../../utils/api-client'
import { leggiRetryAfterSecondi } from '../../utils/dev-login-retry'
import { partitaIvaCasualeValida } from '../../utils/partita-iva'
import { conPrefissoUnico } from '../../utils/run-id'

/**
 * E2E API — Legame movimento, cliente e prezzo (pezzo 4.3b, Task 23).
 *
 * Tutto via API contro backend e database reali. Nessuna interfaccia: l'interfaccia e' la 4.3c.
 *
 * Isolamento. «Fatturazione da» e il registro sono per azienda, quindi lo spec lavora in un'AZIENDA
 * DI TEST DEDICATA, creata in `beforeAll` (con tre utenti ADMIN / OPERATOR / VIEWER e i ruoli di
 * sistema) e mai condivisa con gli altri spec: il suo stato non dipende dall'ordine di esecuzione e
 * lo spec non sposta la data di fatturazione dell'azienda di tutti gli altri. I movimenti del
 * registro non si cancellano (catena di hash): l'azienda, i suoi utenti e i suoi movimenti RESTANO
 * nel database di test, riconoscibili dal prefisso della run nella ragione sociale. Tutto il resto
 * (anagrafiche, contratto, listino) si ripulisce per id esatti.
 *
 * I test sono seriali e ciascuno registra i propri movimenti; i dati di listino condivisi si
 * modificano solo dove il test lo dichiara.
 */

interface Versionata {
  id: string
  versione: number
}

interface Risposta<T = unknown> {
  stato: number
  corpo: T
}

interface Creato {
  tipo: string
  id: string
}

interface RigaVista {
  id: string
  rigaAddebitoId: string
  tipo: string
  origine: 'PRINCIPALE' | 'PROPOSTA' | 'MANUALE'
  quantita: string | null
  quantitaOrigine: 'DA_MOVIMENTO' | 'MANUALE' | null
  prezzo: string | null
  sconto: string | null
  prezzoManuale: boolean
  congelataIl: string | null
}

interface LegameVista {
  id: string
  movimentoOriginaleId: string
  movimentoVigenteId: string
  stato: string
  motivi: string[]
  avvisi: string[]
  motivoEsclusione: string | null
  righe: RigaVista[]
  versione: number
  cliente: { id: string } | null
  contratto: { id: string } | null
  elenco: { id: string } | null
}

interface Fatturazione {
  esito: 'COLLEGATO' | 'NON_RIUSCITO' | 'DA_RIALLINEARE'
  legameId: string | null
  stato: string | null
  motivi: string[]
  avvisi: string[]
}

interface Anteprima {
  firma: string
  cambiano: number
  invariati: number
  differenze: {
    legameId: string
    movimentoId: string
    prezzoPrima: string | null
    prezzoDopo: string | null
  }[]
  saltati: { motivo: string; numero: number }[]
  righeEscluseManuali: number
}

interface Esito {
  aggiornati: number
  saltati: number
}

interface EsitoMassa {
  riusciti: number
  falliti: { legameId: string | null; movimentoId?: string; codice: string }[]
}

interface RigaLista {
  movimentoId: string
  legameId: string | null
  stato: string
  versione: number | null
  motivi: string[]
}

interface Impostazione {
  fatturazioneDa: string | null
  versione: number
}

const CER_A = '15 01 01'
const CER_B = '15 01 07'
const CER_SENZA_RIGA = '15 01 02'

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function codiceCasuale(n: number): string {
  let c = ''
  while (c.length < n) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)]
  return c
}

/** `AAAA-MM-GG` del giorno italiano, spostato di `giorni`. */
function giornoItaliano(giorni = 0): string {
  const d = new Date(Date.now() + giorni * 86_400_000)
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(d)
}

/** Tetto complessivo di attesa dei 429 per una chiamata: la finestra del throttler e` di 60 s. */
const ATTESA_MAX_429_MS = 75_000

/**
 * Chiamata API che restituisce stato e corpo senza lanciare: serve per leggere 400/403/409.
 * Un 429 del throttler globale (100 richieste al minuto per IP, e lo spec e` fitto) si riprova
 * dopo l'attesa indicata dal server (`Retry-After`), entro `ATTESA_MAX_429_MS`: il throttler
 * risponde prima del controller, quindi la richiesta non e` stata eseguita e si puo` ripetere.
 */
async function chiama<T = unknown>(
  metodo: string,
  percorso: string,
  token: string,
  corpo?: unknown
): Promise<Risposta<T>> {
  let tentativo = 0
  let attesaTotaleMs = 0
  for (;;) {
    tentativo++
    const r = await fetch(`${getApiUrl()}${percorso}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    })
    if (r.status === 429) {
      const secondi = leggiRetryAfterSecondi(r.headers) ?? 2 ** Math.min(tentativo, 5)
      const attesaMs = Math.ceil(secondi * 1000) + 100
      if (attesaTotaleMs + attesaMs <= ATTESA_MAX_429_MS) {
        attesaTotaleMs += attesaMs
        await new Promise(res => setTimeout(res, attesaMs))
        continue
      }
    }
    const testo = await r.text()
    let json: unknown = testo
    try {
      json = testo ? JSON.parse(testo) : null
    } catch {
      /* corpo non JSON: resta il testo */
    }
    return { stato: r.status, corpo: json as T }
  }
}

/** Chiamata che deve riuscire (2xx): altrimenti il test fallisce con stato e corpo. */
async function ok<T = unknown>(
  metodo: string,
  percorso: string,
  token: string,
  corpo?: unknown
): Promise<T> {
  const r = await chiama<T>(metodo, percorso, token, corpo)
  expect(r.stato, `${metodo} ${percorso}: ${JSON.stringify(r.corpo)}`).toBeLessThan(300)
  return r.corpo
}

const db = clientDbLocale()

const d = {
  tenantId: '',
  emailAdmin: '',
  emailOperator: '',
  emailViewer: '',
  clienteId: '',
  contrattoId: '',
  elencoId: '',
  rigaCerA: { id: '', versione: 0 },
  rigaCerB: { id: '', versione: 0 },
  rigaV: { id: '', versione: 0 },
}
let creati: Creato[] = []
/** Prezzo corrente della riga CER A nel listino (aggiornato dai test che lo cambiano). */
let prezzoListinoA = '10.00'

const stato = {
  /** Legame CONFERMATO del test 2, riusato dai test sul listino. */
  confermato: { legameId: '', movimentoId: '' },
  /** Legame PROPOSTO del test 3. */
  proposto: { legameId: '', movimentoId: '' },
  /** Legame del test sul prezzo manuale. */
  manuale: { legameId: '', movimentoId: '' },
}

/** Token dei tre utenti dedicati: nessun altro spec li usa, quindi si accede una volta sola. */
const tok = { admin: '', operator: '', viewer: '' }

async function accedi(email: string): Promise<string> {
  return (await devLoginTokens(email)).accessToken
}

/** Imposta «fatturazione da», confermando i movimenti toccati se il server li segnala. */
async function impostaFatturazioneDa(token: string, data: string | null): Promise<Impostazione> {
  const attuale = await ok<Impostazione>('GET', '/impostazioni-fatturazione', token)
  let r = await chiama<{ details?: { movimentiToccati?: number } }>(
    'PUT',
    '/impostazioni-fatturazione',
    token,
    { fatturazioneDa: data, versione: attuale.versione }
  )
  if (r.stato === 409 && typeof r.corpo?.details?.movimentiToccati === 'number') {
    r = await chiama('PUT', '/impostazioni-fatturazione', token, {
      fatturazioneDa: data,
      versione: attuale.versione,
      confermaMovimenti: r.corpo.details.movimentiToccati,
    })
  }
  expect(r.stato, `PUT /impostazioni-fatturazione: ${JSON.stringify(r.corpo)}`).toBe(200)
  return r.corpo as unknown as Impostazione
}

/** Registra un carico INGRESSO_ESTERNO di oggi; `legame` e' il blocco facoltativo. */
async function registra(
  token: string,
  opzioni: { cer?: string; kg?: number; legame?: unknown } = {}
): Promise<{ movimentoId: string; fatturazione?: Fatturazione; avvisi?: string[] }> {
  const r = await chiama<{
    id?: string
    movimento?: { id: string }
    fatturazione?: Fatturazione
    avvisi?: string[]
  }>('POST', '/registro', token, {
    type: 'CARICO',
    movementDate: giornoItaliano(),
    causale: 'INGRESSO_ESTERNO',
    cerCode: opzioni.cer ?? CER_A,
    quantity: opzioni.kg ?? 12.5,
    unit: 'KG',
    counterpartName: conPrefissoUnico('Controparte legami'),
    ...(opzioni.legame === undefined ? {} : { legame: opzioni.legame }),
  })
  expect(r.stato, `POST /registro: ${JSON.stringify(r.corpo)}`).toBe(201)
  const movimentoId = r.corpo.id ?? r.corpo.movimento?.id
  expect(movimentoId).toBeTruthy()
  return { movimentoId: movimentoId!, fatturazione: r.corpo.fatturazione, avvisi: r.corpo.avvisi }
}

const legame = (token: string, id: string) =>
  ok<LegameVista>('GET', `/legami-movimento/${id}`, token)
const perMovimento = (token: string, movimentoId: string) =>
  ok<LegameVista>('GET', `/registro/movimenti/${movimentoId}/legame`, token)
const rigaPrincipale = (l: LegameVista) => l.righe.find(r => r.origine === 'PRINCIPALE')!
const rigaV = (l: LegameVista) => l.righe.find(r => r.tipo === 'V')

async function lista(
  token: string,
  query: string
): Promise<{ elementi: RigaLista[]; totale: number }> {
  return ok('GET', `/legami-movimento?${query}`, token)
}

async function contaPerAzienda(tabella: string): Promise<number> {
  const r = await db!.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM ${tabella} WHERE tenant_id = $1::uuid`,
    d.tenantId
  )
  return Number(r[0].n)
}

test.describe('Legame movimento, cliente e prezzo — API 4.3b', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 })
  test.skip(
    db === null,
    'Serve un database locale (DATABASE_URL su localhost) per creare l’azienda di test dedicata'
  )

  test.beforeAll(async () => {
    if (!db) return
    creati = []
    prezzoListinoA = '10.00'
    const azienda = await creaAziendaDiTest(db, 'legami API')
    d.tenantId = azienda.tenantId
    d.emailAdmin = azienda.email.admin
    d.emailOperator = azienda.email.operator
    d.emailViewer = azienda.email.viewer
    tok.admin = await accedi(d.emailAdmin)
    tok.operator = await accedi(d.emailOperator)
    tok.viewer = await accedi(d.emailViewer)
    const token = tok.admin

    const crea = async <T extends Versionata>(tipo: string, corpo: unknown): Promise<T> => {
      const r = await ok<Record<string, unknown>>('POST', `/${tipo}`, token, corpo)
      const riga = (
        'id' in r ? r : Object.values(r).find(v => typeof v === 'object' && v !== null && 'id' in v)
      ) as T
      creati.push({ tipo, id: riga.id })
      return riga
    }
    await ok('POST', '/registro/registri/assicura', token)
    const registriEsistenti = new Set(
      (await ok<{ codice: string }[]>('GET', '/registri-iva?incluseDisattivate=true', token)).map(
        r => r.codice
      )
    )
    const liberi = Array.from({ length: 99 }, (_, n) => String(n + 1).padStart(2, '0')).filter(
      c => !registriEsistenti.has(c)
    )
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
      ragioneSociale: conPrefissoUnico('Cliente legami'),
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
    d.clienteId = cliente.id
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
      listini: [{ numero: 2, prezzo: '7.00' }],
    })
    const contratto = await crea<Versionata>('contratti-clienti', {
      numero: `L-${codiceCasuale(8)}`,
      descrizione: conPrefissoUnico('Contratto'),
      clienteId: cliente.id,
      dataInizio: '2026-01-01',
      condizionePagamentoId: condizione.id,
      registroIvaId: registro.id,
      incrementoIstat: false,
    })
    d.contrattoId = contratto.id
    // Un legame si propone solo su un contratto ATTIVO; a fine prova si annulla.
    await ok('PATCH', `/contratti-clienti/${contratto.id}/stato`, token, {
      stato: 'ATTIVO',
      versione: contratto.versione,
    })
    const elenco = await ok<Versionata>(
      'POST',
      `/contratti-clienti/${contratto.id}/elenchi`,
      token,
      { descrizione: conPrefissoUnico('Elenco'), predefinito: true }
    )
    d.elencoId = elenco.id
    const rigaCer = (cer: string, prezzo: string) =>
      ok<Versionata>('POST', `/elenchi-addebiti/${elenco.id}/righe`, token, {
        tipo: 'CER',
        cerCode: cer,
        tipoQuantita: 'PESO_NETTO',
        unitaMisura: 'KG',
        codiceIvaId: iva.id,
        prezzo,
      })
    const a = await rigaCer(CER_A, '10.00')
    d.rigaCerA = { id: a.id, versione: a.versione }
    const b = await rigaCer(CER_B, '8.00')
    d.rigaCerB = { id: b.id, versione: b.versione }
    const v = await ok<Versionata>('POST', `/elenchi-addebiti/${elenco.id}/righe`, token, {
      tipo: 'V',
      addebitoId: addebito.id,
      tipoQuantita: 'UNO',
      unitaMisura: 'NR',
      codiceIvaId: iva.id,
      prezzo: '7.00',
      cerProposta: [CER_A.replace(/ /g, ''), CER_B.replace(/ /g, '')],
    })
    d.rigaV = { id: v.id, versione: v.versione }

    await impostaFatturazioneDa(token, giornoItaliano(-30))
  })

  test.afterAll(async () => {
    if (!db) return
    try {
      if (!tok.admin) return
      const token = tok.admin
      const errori: string[] = []
      for (const { tipo, id } of [...creati].reverse()) {
        try {
          let r = await chiama('DELETE', `/${tipo}/${id}`, token)
          if (r.stato < 400) continue
          // In uso (legami, movimenti): i contratti si annullano, il resto si disattiva.
          const riga = await ok<Versionata>('GET', `/${tipo}/${id}`, token)
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
      // «Fatturazione da» appartiene all'azienda dedicata: non serve riportarla indietro.
      expect(errori, 'pulizia dei dati creati dallo spec').toEqual([])
    } finally {
      await db.$disconnect()
    }
  })

  test('la proposta e` in sola lettura: calcola righe e prezzi e non scrive nulla', async () => {
    const token = tok.admin
    const legamiPrima = await contaPerAzienda('legami_movimento')
    const r = await chiama<{
      stato: string
      fatturabile: boolean
      attiva: boolean
      cliente: { id: string; fonte: string } | null
      contratto: { id: string } | null
      elenco: { id: string } | null
      righe: { tipo: string; origine: string; prezzo: string | null; quantita: string | null }[]
      motivi: string[]
    }>('POST', '/legami-movimento/proposta', token, {
      causale: 'INGRESSO_ESTERNO',
      type: 'CARICO',
      cerCode: CER_A,
      movementDate: giornoItaliano(),
      unit: 'KG',
      quantity: '12.5',
      scelte: { clienteId: d.clienteId },
    })
    expect(r.stato, JSON.stringify(r.corpo)).toBe(200)
    expect(r.corpo.fatturabile).toBe(true)
    expect(r.corpo.attiva).toBe(true)
    expect(r.corpo.stato).toBe('PROPOSTO')
    expect(r.corpo.motivi).toEqual([])
    expect(r.corpo.cliente).toMatchObject({ id: d.clienteId, fonte: 'UTENTE' })
    expect(r.corpo.contratto?.id).toBe(d.contrattoId)
    expect(r.corpo.elenco?.id).toBe(d.elencoId)
    const principale = r.corpo.righe.find(x => x.origine === 'PRINCIPALE')
    expect(Number(principale?.prezzo)).toBe(10)
    expect(Number(principale?.quantita)).toBe(12.5)
    expect(r.corpo.righe.some(x => x.tipo === 'V' && x.origine === 'PROPOSTA')).toBe(true)

    expect(await contaPerAzienda('legami_movimento'), 'la proposta non scrive legami').toBe(
      legamiPrima
    )
    expect(await contaPerAzienda('righe_legame_movimento'), 'ne' + ' righe').toBe(0)
  })

  test('registrazione con azione CONFERMA: legame CONFERMATO con i prezzi congelati', async () => {
    const token = tok.admin
    const m = await registra(token, {
      legame: { azione: 'CONFERMA', clienteId: d.clienteId },
    })
    expect(m.fatturazione, 'blocco fatturazione nella risposta').toBeTruthy()
    expect(m.fatturazione).toMatchObject({ esito: 'COLLEGATO', stato: 'CONFERMATO', motivi: [] })
    const l = await legame(token, m.fatturazione!.legameId!)
    expect(l.stato).toBe('CONFERMATO')
    expect(l.movimentoOriginaleId).toBe(m.movimentoId)
    expect(l.cliente?.id).toBe(d.clienteId)
    const principale = rigaPrincipale(l)
    expect(Number(principale.prezzo)).toBe(10)
    expect(Number(principale.quantita)).toBe(12.5)
    expect(l.righe.every(r => r.congelataIl !== null)).toBe(true)
    expect(Number(rigaV(l)?.prezzo)).toBe(7)

    // Il registro legge il legame dal movimento.
    expect((await perMovimento(token, m.movimentoId)).id).toBe(l.id)
    stato.confermato = { legameId: l.id, movimentoId: m.movimentoId }
  })

  test('registrazione senza collegare: il legame nasce PROPOSTO, mai confermato', async () => {
    const token = tok.admin
    const m = await registra(token, {
      kg: 20,
      legame: { azione: 'PROPOSTA', clienteId: d.clienteId },
    })
    expect(m.fatturazione).toMatchObject({ esito: 'COLLEGATO', stato: 'PROPOSTO' })
    const l = await legame(token, m.fatturazione!.legameId!)
    expect(l.stato).toBe('PROPOSTO')
    expect(l.righe.every(r => r.congelataIl === null)).toBe(true)
    stato.proposto = { legameId: l.id, movimentoId: m.movimentoId }

    // Senza alcun blocco `legame` ne' FIR il cliente non si conosce: il movimento e` registrato e
    // il legame c'e`, ma resta da collegare.
    const senzaBlocco = await registra(token, { kg: 3 })
    expect(senzaBlocco.fatturazione).toMatchObject({ esito: 'COLLEGATO', stato: 'DA_COLLEGARE' })
    expect(senzaBlocco.fatturazione!.motivi).toContain('SENZA_CLIENTE')
  })

  test('listino incompleto: movimento registrato, legame DA_COLLEGARE e in lista', async () => {
    const token = tok.admin
    const m = await registra(token, {
      cer: CER_SENZA_RIGA,
      legame: { azione: 'CONFERMA', clienteId: d.clienteId },
    })
    // Il movimento esiste (201) anche se il collegamento e` incompleto.
    expect(m.movimentoId).toBeTruthy()
    expect(m.fatturazione?.stato).toBe('DA_COLLEGARE')
    expect(m.fatturazione?.motivi).toContain('SENZA_RIGA_CER')

    const l = await legame(token, m.fatturazione!.legameId!)
    expect(l.stato).toBe('DA_COLLEGARE')
    const elenco = await lista(token, 'stato=DA_COLLEGARE&dimensione=200')
    const voce = elenco.elementi.find(e => e.movimentoId === m.movimentoId)
    expect(voce, 'il movimento e` nella lista «Da collegare»').toBeTruthy()
    expect(voce!.legameId).toBe(l.id)
    expect(voce!.motivi).toContain('SENZA_RIGA_CER')
    const contatori = await ok<{ daCollegare: number; proposti: number; mancanti: number }>(
      'GET',
      '/legami-movimento/contatori',
      token
    )
    expect(contatori.daCollegare).toBeGreaterThanOrEqual(1)
  })

  test('modifica del listino: il confermato non cambia, «Aggiorna prezzi» (anteprima, poi conferma con firma) si', async () => {
    const token = tok.admin
    // Listino: la riga CER A passa da 10 a 12.
    const mod = await ok<Versionata>('PATCH', `/righe-addebito/${d.rigaCerA.id}`, token, {
      prezzo: '12.00',
      versione: d.rigaCerA.versione,
    })
    d.rigaCerA = { id: d.rigaCerA.id, versione: mod.versione }
    prezzoListinoA = '12.00'

    const prima = await legame(token, stato.confermato.legameId)
    expect(Number(rigaPrincipale(prima).prezzo), 'il legame confermato resta a 10').toBe(10)

    const perimetro = { contrattoId: d.contrattoId }
    const anteprima = await ok<Anteprima>('POST', '/legami-movimento/aggiorna-prezzi', token, {
      perimetro,
    })
    expect(anteprima.firma).toBeTruthy()
    expect(anteprima.cambiano).toBeGreaterThanOrEqual(1)
    const diff = anteprima.differenze.find(x => x.legameId === stato.confermato.legameId)
    expect(diff, 'il legame confermato e` fra le differenze').toBeTruthy()
    expect(Number(diff!.prezzoPrima)).toBe(10)
    expect(Number(diff!.prezzoDopo)).toBe(12)
    // L'anteprima non scrive.
    expect(Number(rigaPrincipale(await legame(token, stato.confermato.legameId)).prezzo)).toBe(10)

    const esito = await ok<Esito>('POST', '/legami-movimento/aggiorna-prezzi', token, {
      perimetro,
      firma: anteprima.firma,
    })
    expect(esito.aggiornati).toBeGreaterThanOrEqual(1)
    const dopo = await legame(token, stato.confermato.legameId)
    expect(dopo.stato).toBe('CONFERMATO')
    expect(Number(rigaPrincipale(dopo).prezzo)).toBe(12)
  })

  test('quantita` manuale non valida: «0», «1.2345», «1,5» e «-2» danno 400; «1.5» e` accettata', async () => {
    const token = tok.admin
    const l = await legame(token, stato.proposto.legameId)
    const riga = rigaPrincipale(l)
    for (const quantita of ['0', '1.2345', '1,5', '-2']) {
      const r = await chiama('PUT', `/legami-movimento/${l.id}`, token, {
        versione: l.versione,
        righe: [{ rigaAddebitoId: riga.rigaAddebitoId, quantita }],
      })
      expect(r.stato, `quantita ${quantita}: ${JSON.stringify(r.corpo)}`).toBe(400)
    }
    expect((await legame(token, l.id)).versione, 'nulla e` cambiato').toBe(l.versione)

    const buona = await ok<LegameVista>('PUT', `/legami-movimento/${l.id}`, token, {
      versione: l.versione,
      righe: [{ rigaAddebitoId: riga.rigaAddebitoId, quantita: '1.5' }],
    })
    expect(Number(rigaPrincipale(buona).quantita)).toBe(1.5)
    expect(rigaPrincipale(buona).quantitaOrigine).toBe('MANUALE')
  })

  test('prezzo modificato a mano (PUT): PREZZO_MANUALE e non sovrascritto da «Aggiorna prezzi»', async () => {
    const token = tok.admin
    const m = await registra(token, {
      kg: 5,
      legame: { azione: 'PROPOSTA', clienteId: d.clienteId },
    })
    const proposta = await legame(token, m.fatturazione!.legameId!)
    expect(Number(rigaPrincipale(proposta).prezzo)).toBe(Number(prezzoListinoA))
    const modificato = await ok<LegameVista>('PUT', `/legami-movimento/${proposta.id}`, token, {
      versione: proposta.versione,
      righe: [{ rigaAddebitoId: rigaPrincipale(proposta).rigaAddebitoId, prezzo: '15.00' }],
    })
    expect(Number(rigaPrincipale(modificato).prezzo)).toBe(15)
    expect(rigaPrincipale(modificato).prezzoManuale).toBe(true)
    expect(modificato.avvisi).toContain('PREZZO_MANUALE')
    stato.manuale = { legameId: modificato.id, movimentoId: m.movimentoId }

    // Il listino cambia ancora (12 -> 13): le righe non manuali seguono, quella a mano no.
    const mod = await ok<Versionata>('PATCH', `/righe-addebito/${d.rigaCerA.id}`, token, {
      prezzo: '13.00',
      versione: d.rigaCerA.versione,
    })
    d.rigaCerA = { id: d.rigaCerA.id, versione: mod.versione }
    prezzoListinoA = '13.00'

    const perimetro = { contrattoId: d.contrattoId }
    const anteprima = await ok<Anteprima>('POST', '/legami-movimento/aggiorna-prezzi', token, {
      perimetro,
    })
    expect(
      anteprima.righeEscluseManuali,
      'la riga a mano e` fra le escluse'
    ).toBeGreaterThanOrEqual(1)
    expect(anteprima.saltati.some(s => s.motivo === 'PREZZO_MANUALE' && s.numero >= 1)).toBe(true)
    expect(
      anteprima.differenze.some(x => x.legameId === stato.manuale.legameId),
      'il legame col prezzo a mano non ha differenze sulla riga manuale'
    ).toBe(false)
    expect(anteprima.differenze.some(x => x.legameId === stato.confermato.legameId)).toBe(true)

    const esito = await ok<Esito>('POST', '/legami-movimento/aggiorna-prezzi', token, {
      perimetro,
      firma: anteprima.firma,
    })
    expect(esito.aggiornati).toBeGreaterThanOrEqual(1)
    const manuale = await legame(token, stato.manuale.legameId)
    expect(Number(rigaPrincipale(manuale).prezzo), 'il prezzo a mano resta 15').toBe(15)
    expect(rigaPrincipale(manuale).prezzoManuale).toBe(true)
    const confermato = await legame(token, stato.confermato.legameId)
    expect(Number(rigaPrincipale(confermato).prezzo), 'le altre righe cambiano').toBe(13)
  })

  test('rettifica che cambia il CER: il legame torna PROPOSTO con l`avviso da confermare', async () => {
    const token = tok.admin
    const m = await registra(token, {
      kg: 8,
      legame: { azione: 'CONFERMA', clienteId: d.clienteId },
    })
    expect(m.fatturazione?.stato).toBe('CONFERMATO')
    const r = await chiama<{ fatturazione?: Fatturazione; avvisi: string[] }>(
      'POST',
      `/registro/movimenti/${m.movimentoId}/rettifica`,
      token,
      {
        motivo: 'Codice CER errato in fase di registrazione',
        movementDate: giornoItaliano(),
        causale: 'INGRESSO_ESTERNO',
        cerCode: CER_B,
        quantity: 8,
        unit: 'KG',
        counterpartName: conPrefissoUnico('Controparte legami'),
      }
    )
    expect(r.stato, JSON.stringify(r.corpo)).toBe(201)
    expect(r.corpo.fatturazione).toMatchObject({ esito: 'COLLEGATO', stato: 'PROPOSTO' })
    expect(r.corpo.fatturazione!.avvisi).toContain('CAMBIO_CER_DA_CONFERMARE')

    const l = await perMovimento(token, m.movimentoId)
    expect(l.stato).toBe('PROPOSTO')
    expect(l.avvisi).toContain('CAMBIO_CER_DA_CONFERMARE')
    expect(l.movimentoVigenteId).not.toBe(l.movimentoOriginaleId)
    expect(rigaPrincipale(l).rigaAddebitoId).toBe(d.rigaCerB.id)
    expect(Number(rigaPrincipale(l).prezzo)).toBe(8)

    // Nuova conferma esplicita: CONFERMATO.
    const confermato = await ok<LegameVista>('POST', `/legami-movimento/${l.id}/conferma`, token, {
      versione: l.versione,
    })
    expect(confermato.stato).toBe('CONFERMATO')
  })

  test('annullo del movimento: il legame diventa ANNULLATO', async () => {
    const token = tok.admin
    const m = await registra(token, {
      kg: 4,
      legame: { azione: 'CONFERMA', clienteId: d.clienteId },
    })
    const r = await chiama('POST', `/registro/movimenti/${m.movimentoId}/annullamento`, token, {
      motivo: 'Registrato per errore',
    })
    expect(r.stato, JSON.stringify(r.corpo)).toBe(201)
    const l = await perMovimento(token, m.movimentoId)
    expect(l.stato).toBe('ANNULLATO')
    expect(l.id).toBe(m.fatturazione!.legameId)
  })

  test('escludi con motivo e riammetti', async () => {
    const token = tok.admin
    const m = await registra(token, {
      kg: 6,
      legame: { azione: 'PROPOSTA', clienteId: d.clienteId },
    })
    const l = await legame(token, m.fatturazione!.legameId!)

    const senzaMotivo = await chiama('POST', `/legami-movimento/${l.id}/escludi`, token, {
      versione: l.versione,
      motivo: '',
    })
    expect(senzaMotivo.stato).toBe(400)

    const escluso = await ok<LegameVista>('POST', `/legami-movimento/${l.id}/escludi`, token, {
      versione: l.versione,
      motivo: 'Fornitura gratuita al cliente',
    })
    expect(escluso.stato).toBe('ESCLUSO')
    expect(escluso.motivoEsclusione).toBe('Fornitura gratuita al cliente')
    // Fuori dalla lista di default, dentro con `esclusi=true`.
    const normale = await lista(token, 'dimensione=200')
    expect(normale.elementi.find(e => e.movimentoId === m.movimentoId)).toBeUndefined()
    const conEsclusi = await lista(token, 'esclusi=true&dimensione=200')
    expect(conEsclusi.elementi.find(e => e.movimentoId === m.movimentoId)?.stato).toBe('ESCLUSO')

    // Versione vecchia: 409.
    const vecchia = await chiama('POST', `/legami-movimento/${l.id}/riammetti`, token, {
      versione: l.versione,
    })
    expect(vecchia.stato).toBe(409)
    const riammesso = await ok<LegameVista>('POST', `/legami-movimento/${l.id}/riammetti`, token, {
      versione: escluso.versione,
    })
    expect(riammesso.stato).toBe('PROPOSTO')
    expect(riammesso.motivoEsclusione).toBeNull()
  })

  test('azioni di massa: conferma, escludi e movimentoIds per i movimenti mancanti', async () => {
    const token = tok.admin
    const proposta = (kg: number) =>
      registra(token, { kg, legame: { azione: 'PROPOSTA', clienteId: d.clienteId } })
    const a = await proposta(2)
    const b = await proposta(3)
    const c = await proposta(4)
    const la = await legame(token, a.fatturazione!.legameId!)
    const lb = await legame(token, b.fatturazione!.legameId!)
    const lc = await legame(token, c.fatturazione!.legameId!)

    // CONFERMA su due legami, di cui uno con versione vecchia: il primo riesce, il secondo no.
    const conferma = await ok<EsitoMassa>('POST', '/legami-movimento/azioni', token, {
      azione: 'CONFERMA',
      elementi: [
        { legameId: la.id, versione: la.versione },
        { legameId: lb.id, versione: lb.versione + 5 },
      ],
    })
    expect(conferma.riusciti).toBe(1)
    expect(conferma.falliti).toHaveLength(1)
    expect(conferma.falliti[0].legameId).toBe(lb.id)
    expect((await legame(token, la.id)).stato).toBe('CONFERMATO')
    expect((await legame(token, lb.id)).stato).toBe('PROPOSTO')

    // ESCLUDI in massa senza motivo: nulla cambia.
    const senzaMotivo = await chiama<EsitoMassa>('POST', '/legami-movimento/azioni', token, {
      azione: 'ESCLUDI',
      elementi: [{ legameId: lb.id, versione: lb.versione }],
    })
    if (senzaMotivo.stato === 200) expect(senzaMotivo.corpo.riusciti).toBe(0)
    else expect(senzaMotivo.stato).toBe(400)
    expect((await legame(token, lb.id)).stato).toBe('PROPOSTO')

    const escludi = await ok<EsitoMassa>('POST', '/legami-movimento/azioni', token, {
      azione: 'ESCLUDI',
      motivo: 'Prova di esclusione in massa',
      elementi: [
        { legameId: lb.id, versione: lb.versione },
        { legameId: lc.id, versione: lc.versione },
      ],
    })
    expect(escludi.riusciti).toBe(2)
    expect((await legame(token, lb.id)).stato).toBe('ESCLUSO')
    expect((await legame(token, lc.id)).stato).toBe('ESCLUSO')

    // MANCANTI: un movimento registrato con la fatturazione spenta non ha legame; riaccesa la data,
    // compare in lista come MANCANTE e si lavora per `movimentoIds`.
    await impostaFatturazioneDa(token, null)
    const mancante = await registra(token, { kg: 1 })
    const altroMancante = await registra(token, { kg: 2 })
    expect(mancante.fatturazione, 'fatturazione spenta: nessun blocco').toBeUndefined()
    expect(altroMancante.fatturazione).toBeUndefined()
    await impostaFatturazioneDa(token, giornoItaliano(-30))
    const inLista = await lista(token, 'stato=MANCANTE&dimensione=200')
    const voce = inLista.elementi.find(e => e.movimentoId === mancante.movimentoId)
    expect(voce, 'il movimento senza legame e` in lista come mancante').toBeTruthy()
    expect(voce!.legameId).toBeNull()

    // CONFERMA in massa sul mancante: il cliente non si conosce (nessun FIR), il tentativo fallisce
    // per quel movimento senza fermare nulla.
    const tentativo = await ok<EsitoMassa>('POST', '/legami-movimento/azioni', token, {
      azione: 'CONFERMA',
      movimentoIds: [mancante.movimentoId],
    })
    expect(tentativo.riusciti).toBe(0)
    expect(tentativo.falliti).toHaveLength(1)
    expect(tentativo.falliti[0].movimentoId).toBe(mancante.movimentoId)
    // Il tentativo ha comunque creato il legame, rimasto da collegare (non piu` «mancante»).
    const rimasto = await perMovimento(token, mancante.movimentoId)
    expect(rimasto.stato).toBe('DA_COLLEGARE')
    expect(rimasto.motivi).toContain('SENZA_CLIENTE')

    // ESCLUDI per movimentoIds: crea il legame e lo esclude in un passo.
    const esclusione = await ok<EsitoMassa>('POST', '/legami-movimento/azioni', token, {
      azione: 'ESCLUDI',
      motivo: 'Movimento precedente alla fatturazione',
      movimentoIds: [altroMancante.movimentoId],
    })
    expect(esclusione.riusciti, JSON.stringify(esclusione)).toBe(1)
    expect(esclusione.falliti).toEqual([])
    expect((await perMovimento(token, altroMancante.movimentoId)).stato).toBe('ESCLUSO')
  })

  test('permessi: VIEWER 403 sulle scritture, OPERATOR 403 su «Aggiorna prezzi»', async () => {
    const { admin, viewer, operator: operatore } = tok
    const l = await legame(admin, stato.proposto.legameId)
    const perimetro = { contrattoId: d.contrattoId }

    // Letture aperte al VIEWER.
    expect((await chiama('GET', `/legami-movimento/${l.id}`, viewer)).stato).toBe(200)
    expect((await chiama('GET', '/legami-movimento', viewer)).stato).toBe(200)
    expect((await chiama('GET', '/legami-movimento/contatori', viewer)).stato).toBe(200)

    const scritture: [string, string, unknown][] = [
      ['PUT', `/legami-movimento/${l.id}`, { versione: l.versione, righe: [] }],
      ['POST', `/legami-movimento/${l.id}/conferma`, { versione: l.versione }],
      ['POST', `/legami-movimento/${l.id}/escludi`, { versione: l.versione, motivo: 'x' }],
      ['POST', `/legami-movimento/${l.id}/riammetti`, { versione: l.versione }],
      [
        'POST',
        '/legami-movimento/azioni',
        { azione: 'CONFERMA', elementi: [{ legameId: l.id, versione: l.versione }] },
      ],
      ['POST', `/legami-movimento/da-movimento/${l.movimentoOriginaleId}`, undefined],
      ['POST', '/legami-movimento/aggiorna-prezzi', { perimetro }],
    ]
    for (const [metodo, percorso, corpo] of scritture) {
      const r = await chiama(metodo, percorso, viewer, corpo)
      expect(r.stato, `VIEWER ${metodo} ${percorso}: ${JSON.stringify(r.corpo)}`).toBe(403)
    }
    // OPERATOR: «Aggiorna prezzi» (anteprima e applica) e` degli amministratori.
    for (const corpo of [{ perimetro }, { perimetro, firma: 'firma-qualsiasi' }]) {
      const r = await chiama('POST', '/legami-movimento/aggiorna-prezzi', operatore, corpo)
      expect(r.stato, `OPERATOR aggiorna-prezzi: ${JSON.stringify(r.corpo)}`).toBe(403)
    }
    // ...ma scrive il resto: una modifica non valida arriva al servizio (400, non 403).
    const prova = await chiama('PUT', `/legami-movimento/${l.id}`, operatore, {
      versione: l.versione,
      righe: [{ rigaAddebitoId: rigaPrincipale(l).rigaAddebitoId, quantita: '0' }],
    })
    expect(prova.stato).toBe(400)
    // Il legame non e` stato toccato dai tentativi rifiutati.
    expect((await legame(admin, l.id)).versione).toBe(l.versione)
  })

  test('eliminare una riga di listino usata da un legame: 409 RIGA_ADDEBITO_IN_USO', async () => {
    const token = tok.admin
    const riga = await ok<Versionata>('GET', `/righe-addebito/${d.rigaCerA.id}`, token)
    const r = await chiama<{ error?: string; message?: string }>(
      'DELETE',
      `/righe-addebito/${d.rigaCerA.id}?versione=${riga.versione}`,
      token
    )
    expect(r.stato, JSON.stringify(r.corpo)).toBe(409)
    expect(r.corpo.error).toBe('RIGA_ADDEBITO_IN_USO')
    // La riga c'e` ancora.
    const ancora = await ok<{ id: string }[]>('GET', `/elenchi-addebiti/${d.elencoId}/righe`, token)
    expect(ancora.some(x => x.id === d.rigaCerA.id)).toBe(true)
  })
})
