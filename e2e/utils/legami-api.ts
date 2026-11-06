import { expect } from '@playwright/test'
import { getApiUrl } from './env'
import { leggiRetryAfterSecondi } from './dev-login-retry'
import { partitaIvaCasualeValida } from './partita-iva'
import { conPrefissoUnico } from './run-id'

/**
 * Supporto API per gli e2e del legame movimento (4.3c): preparazione dei dati via API e lettura
 * dello stato dopo le azioni fatte dall'interfaccia. Nessun dato si tocca fuori dall'azienda di
 * test dedicata dello spec che lo usa; la pulizia e' per id esatti (`pulisciCreati`).
 */

export interface Versionata {
  id: string
  versione: number
}

export interface Creato {
  tipo: string
  id: string
}

export interface Risposta<T = unknown> {
  stato: number
  corpo: T
}

export interface RigaVista {
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

export interface LegameVista {
  id: string
  movimentoOriginaleId: string
  movimentoVigenteId: string
  stato: string
  motivi: string[]
  avvisi: string[]
  righe: RigaVista[]
  versione: number
}

export const CER_A = '15 01 01'
export const CER_B = '15 01 07'
/** Codice CER di una riga di listino che nessun movimento usa mai (per il confronto «non in uso»). */
export const CER_RIGA_LIBERA = '15 01 03'

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function codiceCasuale(n: number): string {
  let c = ''
  while (c.length < n) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)]
  return c
}

/** `AAAA-MM-GG` del giorno italiano, spostato di `giorni`. */
export function giornoItaliano(giorni = 0): string {
  const d = new Date(Date.now() + giorni * 86_400_000)
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(d)
}

/** Tetto complessivo di attesa dei 429 per una chiamata (la finestra del throttler e' di 60 s). */
const ATTESA_MAX_429_MS = 75_000

/**
 * Chiamata API che restituisce stato e corpo senza lanciare. Un 429 del throttler globale si
 * riprova dopo `Retry-After` (il throttler risponde prima del controller: nulla e' stato eseguito).
 */
export async function chiama<T = unknown>(
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
export async function ok<T = unknown>(
  metodo: string,
  percorso: string,
  token: string,
  corpo?: unknown
): Promise<T> {
  const r = await chiama<T>(metodo, percorso, token, corpo)
  expect(r.stato, `${metodo} ${percorso}: ${JSON.stringify(r.corpo)}`).toBeLessThan(300)
  return r.corpo
}

export const legame = (token: string, id: string) =>
  ok<LegameVista>('GET', `/legami-movimento/${id}`, token)
export const legamePerMovimento = (token: string, movimentoId: string) =>
  ok<LegameVista>('GET', `/registro/movimenti/${movimentoId}/legame`, token)
export const rigaPrincipale = (l: LegameVista) => l.righe.find(r => r.origine === 'PRINCIPALE')!
export const rigaV = (l: LegameVista) => l.righe.find(r => r.tipo === 'V')

/** Registra un carico INGRESSO_ESTERNO di oggi via API; `legame` e' il blocco facoltativo. */
export async function registraViaApi(
  token: string,
  opzioni: { cer?: string; kg?: number; legame?: unknown } = {}
): Promise<{ movimentoId: string; legameId: string | null }> {
  const r = await chiama<{
    id?: string
    movimento?: { id: string }
    fatturazione?: { legameId: string | null }
  }>('POST', '/registro', token, {
    type: 'CARICO',
    movementDate: giornoItaliano(),
    causale: 'INGRESSO_ESTERNO',
    cerCode: opzioni.cer ?? CER_A,
    quantity: opzioni.kg ?? 12.5,
    unit: 'KG',
    counterpartName: conPrefissoUnico('Controparte legami UI'),
    ...(opzioni.legame === undefined ? {} : { legame: opzioni.legame }),
  })
  expect(r.stato, `POST /registro: ${JSON.stringify(r.corpo)}`).toBe(201)
  const movimentoId = r.corpo.id ?? r.corpo.movimento?.id
  expect(movimentoId).toBeTruthy()
  return { movimentoId: movimentoId!, legameId: r.corpo.fatturazione?.legameId ?? null }
}

/** Imposta «fatturazione da», confermando i movimenti toccati se il server li segnala. */
export async function impostaFatturazioneDa(token: string, data: string | null): Promise<void> {
  const attuale = await ok<{ versione: number }>('GET', '/impostazioni-fatturazione', token)
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
}

/** Dati di listino dell'azienda di test: cliente, contratto ATTIVO, elenco e righe. */
export interface ListinoLegami {
  clienteId: string
  clienteEtichetta: string
  contrattoId: string
  contrattoNumero: string
  elencoId: string
  rigaCerA: Versionata
  rigaCerB: Versionata
  rigaV: Versionata
  rigaLibera: Versionata
}

/**
 * Crea via API il listino minimo per i legami: registro IVA, condizione, cliente con P.IVA valida,
 * addebito V, contratto ATTIVO, elenco predefinito con tre righe (CER A a 10, CER B a 8, V a 7
 * proposta sui due CER) e una riga CER mai usata. Ogni id creato entra in `creati` (pulizia).
 */
export async function creaListinoLegami(
  token: string,
  creati: Creato[],
  opzioni: { modalitaPagamento?: string } = {}
): Promise<ListinoLegami> {
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
    modalita: opzioni.modalitaPagamento ?? 'MP05',
    giorniRate: [30],
    fineMese: false,
  })
  const ragioneSociale = conPrefissoUnico('Cliente legami UI')
  const cliente = await crea<Versionata>('clienti', {
    ragioneSociale,
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
    listini: [{ numero: 2, prezzo: '7.00' }],
  })
  const numero = `L-${codiceCasuale(8)}`
  const contratto = await crea<Versionata>('contratti-clienti', {
    numero,
    descrizione: conPrefissoUnico('Contratto'),
    clienteId: cliente.id,
    dataInizio: '2026-01-01',
    condizionePagamentoId: condizione.id,
    registroIvaId: registro.id,
    incrementoIstat: false,
  })
  // Un legame si propone solo su un contratto ATTIVO; a fine prova si annulla.
  await ok('PATCH', `/contratti-clienti/${contratto.id}/stato`, token, {
    stato: 'ATTIVO',
    versione: contratto.versione,
  })
  const elenco = await ok<Versionata>('POST', `/contratti-clienti/${contratto.id}/elenchi`, token, {
    descrizione: conPrefissoUnico('Elenco'),
    predefinito: true,
  })
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
  const b = await rigaCer(CER_B, '8.00')
  const v = await ok<Versionata>('POST', `/elenchi-addebiti/${elenco.id}/righe`, token, {
    tipo: 'V',
    addebitoId: addebito.id,
    tipoQuantita: 'UNO',
    unitaMisura: 'NR',
    codiceIvaId: iva.id,
    prezzo: '7.00',
    cerProposta: [CER_A.replace(/ /g, ''), CER_B.replace(/ /g, '')],
  })
  const libera = await rigaCer(CER_RIGA_LIBERA, '5.00')
  return {
    clienteId: cliente.id,
    clienteEtichetta: ragioneSociale,
    contrattoId: contratto.id,
    contrattoNumero: numero,
    elencoId: elenco.id,
    rigaCerA: a,
    rigaCerB: b,
    rigaV: v,
    rigaLibera: libera,
  }
}

/** Pulizia per id esatti (dal piu' recente): elimina, o annulla/disattiva se il dato e' in uso. */
export async function pulisciCreati(token: string, creati: Creato[]): Promise<string[]> {
  const errori: string[] = []
  for (const { tipo, id } of [...creati].reverse()) {
    try {
      let r = await chiama('DELETE', `/${tipo}/${id}`, token)
      if (r.stato < 400) continue
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
  return errori
}
