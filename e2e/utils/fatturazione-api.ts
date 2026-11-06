import { expect } from '@playwright/test'
import { chiama, codiceCasuale, giornoItaliano, ok, creaListinoLegami } from './legami-api'
import type { Creato, ListinoLegami, Risposta, Versionata } from './legami-api'
import { conPrefissoUnico } from './run-id'
import type { StatoElaborazione } from '../../apps/frontend/src/app/features/fatturazione/fatturazione.model'

/**
 * Supporto API per gli e2e della fatturazione per periodo (4.4b1, Task 26a): periodo, listino con
 * una riga `F`, attese dei job BullMQ e confronto delle chiavi delle risposte con il modello del
 * frontend. Niente di questo file importa `apps/backend/src` (scansione P45); l'unico import dal
 * frontend e` di TIPI di `fatturazione.model.ts`, che non dipende da Angular (Q21).
 */

export type { Creato, ListinoLegami, Risposta, Versionata }
export { chiama, ok, giornoItaliano }

/** Somma `giorni` a una data `AAAA-MM-GG` (aritmetica in UTC: nessun salto d'ora). */
export function spostaGiorni(data: string, giorni: number): string {
  const d = new Date(`${data}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + giorni)
  return d.toISOString().slice(0, 10)
}

/**
 * Periodo della prova (Q26): `[max(1 gennaio dell'anno corrente, oggi - 60), oggi]`. I movimenti
 * sono di oggi e la scadenza della riga `F` e` dieci giorni fa (sempre nel periodo, mai anteriore
 * al 1 gennaio); `fatturazione_da` e` l'inizio del periodo.
 */
export function periodoDiProva(): { dal: string; al: string; scadenzaF: string } {
  const oggi = giornoItaliano()
  const gennaio = `${oggi.slice(0, 4)}-01-01`
  const sessanta = spostaGiorni(oggi, -60)
  const dal = sessanta > gennaio ? sessanta : gennaio
  // Dieci giorni fa, ma non prima dell'inizio del periodo (a inizio anno il periodo e` corto).
  const dieci = spostaGiorni(oggi, -10)
  return { dal, al: oggi, scadenzaF: dieci >= dal ? dieci : dal }
}

export interface PaginaApi<T> {
  elementi: T[]
  totale: number
  pagina: number
  dimensione: number
}

export interface ElaborazioneApi {
  id: string
  stato: StatoElaborazione
  versione: number
  impronta: string | null
  documenti: number
  errori: number
  definitiveAttive: boolean
  erroriGenerali: { codice: string }[]
  errore: { codice: string } | null
  erroreTecnico: string | null
  numerazionePrevista: { registroIvaId: string; codiceRegistro: string; da: string; a: string }[]
}

export interface DocumentoApi {
  id: string
  stato: string
  tipoDocumento: string
  numeroTesto: string | null
  dataDocumento: string
  registro: { id: string; codice: string }
  totaleDocumento: string
  annullabile: boolean
  motivoNonAnnullabile: string | null
  stornabile: boolean
  errori: { codice: string }[]
}

export interface DocumentoDettaglioApi extends DocumentoApi {
  righe: { tipoRiga: string; legameId: string | null; numeroLinea: number }[]
  versione: number
  documentoOrigineId: string | null
  stornoId: string | null
}

export interface ScostamentoApi {
  legameId: string
  versioneLegame: number
  documento: { id: string; numeroTesto: string; dataDocumento: string }
  tipoCorrezione: string
}

export interface NumerazioneApi {
  registroIvaId: string
  anno: number
  ultimoNumero: number
}

/** Le chiavi di un oggetto devono essere esattamente quelle della costante `CHIAVI_*` (Q21). */
export function chiaviUguali(
  etichetta: string,
  reale: Record<string, unknown>,
  attese: Record<string, true>
): void {
  expect(Object.keys(reale).sort(), `chiavi di ${etichetta}`).toEqual(Object.keys(attese).sort())
}

/** Attende (sondando) che un'elaborazione raggiunga uno degli stati; fallisce con lo stato trovato. */
export async function attendiElaborazione(
  token: string,
  id: string,
  stati: StatoElaborazione[],
  timeoutMs = 60_000
): Promise<ElaborazioneApi> {
  const fine = Date.now() + timeoutMs
  let ultima: ElaborazioneApi | undefined
  while (Date.now() < fine) {
    ultima = await ok<ElaborazioneApi>('GET', `/elaborazioni-fatturazione/${id}`, token)
    if (stati.includes(ultima.stato)) return ultima
    if (ultima.stato === 'FALLITA') {
      throw new Error(
        `elaborazione FALLITA: ${ultima.erroreTecnico ?? JSON.stringify(ultima.errore)}`
      )
    }
    await new Promise(r => setTimeout(r, 400))
  }
  throw new Error(
    `elaborazione ${id} non arrivata a ${stati.join('|')} in ${timeoutMs} ms (stato ${ultima?.stato})`
  )
}

/** Avvia l'anteprima (202) e attende `ANTEPRIMA_PRONTA`. */
export async function anteprimaPronta(
  token: string,
  periodo: { dal: string; al: string },
  dataDocumento: string
): Promise<ElaborazioneApi> {
  const avvio = await chiama<{ id: string }>('POST', '/elaborazioni-fatturazione', token, {
    periodoDal: periodo.dal,
    periodoAl: periodo.al,
    dataDocumento,
    raggruppamento: 'PER_CONTRATTO',
    includiArretrati: false,
    filtri: {},
  })
  expect(avvio.stato, `avvio: ${JSON.stringify(avvio.corpo)}`).toBe(202)
  return attendiElaborazione(token, avvio.corpo.id, ['ANTEPRIMA_PRONTA'])
}

export const documentiDi = (token: string, elaborazioneId: string) =>
  ok<PaginaApi<DocumentoApi>>(
    'GET',
    `/elaborazioni-fatturazione/${elaborazioneId}/documenti?pagina=1&dimensione=100`,
    token
  )

export const dettaglioDocumento = (token: string, id: string) =>
  ok<DocumentoDettaglioApi>('GET', `/documenti-fattura/${id}`, token)

/** Chiede la definitiva (202) con impronta e versione dell'anteprima e attende `DEFINITIVA`. */
export async function definitivaCompleta(
  token: string,
  e: ElaborazioneApi
): Promise<ElaborazioneApi> {
  const r = await chiama('POST', `/elaborazioni-fatturazione/${e.id}/definitiva`, token, {
    impronta: e.impronta,
    versione: e.versione,
  })
  expect(r.stato, `definitiva: ${JSON.stringify(r.corpo)}`).toBe(202)
  return attendiElaborazione(token, e.id, ['DEFINITIVA'])
}

/**
 * Aggiunge al listino della prova una riga `F` (canone con scadenza fissa dentro il periodo) e
 * un secondo elenco con la sua riga `CER`, per il cambio di elenco dopo l'annullo (Q1).
 */
export async function aggiungiRigaFEdElencoAlternativo(
  token: string,
  creati: Creato[],
  listino: ListinoLegami,
  scadenzaF: string | null
): Promise<{ elencoAlternativoId: string }> {
  const crea = async (tipo: string, corpo: unknown): Promise<Versionata> => {
    const r = await ok<Versionata>('POST', `/${tipo}`, token, corpo)
    creati.push({ tipo, id: r.id })
    return r
  }
  const rigaCer = await ok<{ codiceIva: { id: string } | null }>(
    'GET',
    `/righe-addebito/${listino.rigaCerA.id}`,
    token
  )
  const codiceIvaId = rigaCer.codiceIva!.id
  const gruppo = await crea('codifiche-addebito', {
    genere: 'GRUPPO',
    descrizione: conPrefissoUnico('Gruppo F'),
  })
  const addebitoF = await crea('addebiti', {
    descrizione: conPrefissoUnico('Canone F'),
    gruppoId: gruppo.id,
    unitaMisura: 'NR',
    codiceIvaId,
    tipo: 'F',
    listini: [{ numero: 2, prezzo: '3.00' }],
  })
  if (scadenzaF !== null) {
    const [anno, mese, giorno] = scadenzaF.split('-').map(Number)
    await ok('POST', `/elenchi-addebiti/${listino.elencoId}/righe`, token, {
      tipo: 'F',
      addebitoId: addebitoF.id,
      unitaMisura: 'NR',
      codiceIvaId,
      prezzo: '3.00',
      quantitaFissa: '1',
      scadenze: [{ ordine: 1, giorno, mese, anno }],
    })
  }
  // Elenco alternativo (non predefinito) con una riga CER propria, per cambiare elenco al legame.
  const alt = await ok<Versionata>(
    'POST',
    `/contratti-clienti/${listino.contrattoId}/elenchi`,
    token,
    {
      descrizione: `Alternativo ${codiceCasuale(6)}`,
      predefinito: false,
    }
  )
  await ok('POST', `/elenchi-addebiti/${alt.id}/righe`, token, {
    tipo: 'CER',
    cerCode: '15 01 01',
    tipoQuantita: 'PESO_NETTO',
    unitaMisura: 'KG',
    codiceIvaId,
    prezzo: '9.00',
  })
  return { elencoAlternativoId: alt.id }
}

export { codiceCasuale, creaListinoLegami }
