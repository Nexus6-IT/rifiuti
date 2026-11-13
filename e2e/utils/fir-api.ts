import { expect } from '@playwright/test'
import { registra } from '../fixtures/risorse'
import { esentaDallaBlacklist } from './blacklist'
import { chiama, CER_A, ok, type Risposta } from './legami-api'
import { partitaIvaCasualeValida } from './partita-iva'
import { conPrefissoUnico } from './run-id'

/**
 * Supporto API per gli e2e di FIR e registro: anagrafiche, formulari portati a uno stato dato e
 * pulizia per id esatti. Tutto dentro l'azienda di test dedicata dello spec che lo usa (token di un
 * suo utente): niente dipende da righe preesistenti, il database della CI parte vuoto.
 */

export interface Anagrafiche {
  produttore: { id: string; ragioneSociale: string }
  trasportatore: { id: string; ragioneSociale: string }
  destinatario: { id: string; ragioneSociale: string }
}

export type StatoFir = 'BOZZA' | 'EMESSO' | 'IN_TRANSITO' | 'CONSEGNATO'

export interface FirVisto {
  id: string
  numeroProgressivo?: string | null
  stato: string
  rentriSyncStatus?: string | null
  pesoEffettivo?: number | null
  rifiuto: { cerCode: string; quantita: number; unitaMisura: string }
}

const SEDE = {
  via: 'Via delle Prove',
  civico: '7',
  cap: '20100',
  comune: 'Milano',
  provincia: 'MI',
}

/** Anagrafiche cancellate in `eliminaAnagrafiche`: per tipo (segmento REST) e id. */
export interface AnagraficaCreata {
  segmento: 'produttori' | 'trasportatori' | 'destinatari'
  id: string
}

/**
 * Crea produttore, trasportatore e destinatario nell'azienda del token. Ogni id va in `creati`
 * (pulizia per id esatti con `eliminaAnagrafiche`).
 */
export async function creaAnagrafiche(
  token: string,
  creati: AnagraficaCreata[]
): Promise<Anagrafiche> {
  const anno = new Date().getFullYear()
  const crea = async (
    segmento: AnagraficaCreata['segmento'],
    corpo: Record<string, unknown>
  ): Promise<{ id: string; ragioneSociale: string }> => {
    const r = await ok<{ id: string; ragioneSociale: string }>(
      'POST',
      `/registry/${segmento}`,
      token,
      corpo
    )
    creati.push({ segmento, id: r.id })
    return { id: r.id, ragioneSociale: corpo.ragioneSociale as string }
  }
  const produttore = await crea('produttori', {
    ragioneSociale: conPrefissoUnico('Produttore FIR'),
    partitaIVA: partitaIvaCasualeValida(),
    sedeLegale: SEDE,
  })
  const trasportatore = await crea('trasportatori', {
    ragioneSociale: conPrefissoUnico('Trasportatore FIR'),
    partitaIVA: partitaIvaCasualeValida(),
    sedeLegale: SEDE,
    numeroIscrizione: `MI/${Math.floor(Math.random() * 900000 + 100000)}`,
  })
  const destinatario = await crea('destinatari', {
    ragioneSociale: conPrefissoUnico('Destinatario FIR'),
    partitaIVA: partitaIvaCasualeValida(),
    sede: SEDE,
    numeroAutorizzazione: `AUT/${anno}/${Math.floor(Math.random() * 9000 + 1000)}`,
  })
  return { produttore, trasportatore, destinatario }
}

/** Cancella le anagrafiche create, per id esatti, con il token dell'azienda che le possiede. */
export async function eliminaAnagrafiche(
  token: string,
  creati: AnagraficaCreata[]
): Promise<string[]> {
  const errori: string[] = []
  for (const { segmento, id } of [...creati].reverse()) {
    esentaDallaBlacklist(id)
    const r = await chiama('DELETE', `/registry/${segmento}/${id}`, token)
    if (r.stato >= 400 && r.stato !== 404) {
      errori.push(`${segmento}/${id}: ${r.stato} ${JSON.stringify(r.corpo)}`)
    }
  }
  return errori
}

/** Crea un FIR in BOZZA (CER `15 01 01`, 10 kg, rifiuto speciale, trasporto terrestre). */
export async function creaFirBozza(
  token: string,
  a: Anagrafiche,
  opzioni: { cer?: string; quantita?: number } = {}
): Promise<FirVisto> {
  const fir = await ok<FirVisto>('POST', '/fir', token, {
    produttoreId: a.produttore.id,
    trasportatoreId: a.trasportatore.id,
    destinatarioId: a.destinatario.id,
    rifiuto: { cerCode: opzioni.cer ?? CER_A, quantita: opzioni.quantita ?? 10, unitaMisura: 'kg' },
    provenienza: 'SPECIALE',
    tipoTrattaPrincipale: 'TERRESTRE',
  })
  // I FIR non hanno una cancellazione HTTP: li toglie il teardown globale dal database, per id e
  // solo se lo snapshot porta il prefisso della run.
  registra('fir', fir.id)
  return fir
}

/** Crea un FIR e lo porta (via API) fino allo stato richiesto. */
export async function creaFirInStato(
  token: string,
  a: Anagrafiche,
  stato: StatoFir,
  opzioni: { cer?: string; quantita?: number } = {}
): Promise<FirVisto> {
  let fir = await creaFirBozza(token, a, opzioni)
  if (stato === 'BOZZA') return fir
  fir = await ok<FirVisto>('POST', `/fir/${fir.id}/emetti`, token, {})
  if (stato === 'EMESSO') return fir
  fir = await ok<FirVisto>('POST', `/fir/${fir.id}/presa-in-carico`, token, {})
  if (stato === 'IN_TRANSITO') return fir
  return ok<FirVisto>('POST', `/fir/${fir.id}/conferma-consegna`, token, {
    pesoEffettivo: opzioni.quantita ?? 10,
  })
}

export async function leggiFir(token: string, id: string): Promise<FirVisto> {
  return ok<FirVisto>('GET', `/fir/${id}`, token)
}

export type { Risposta }
export { expect }
