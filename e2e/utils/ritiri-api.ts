import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import { esentaDallaBlacklist } from './blacklist'
import { chiama, CER_A, giornoItaliano, ok } from './legami-api'
import { partitaIvaCasualeValida } from './partita-iva'
import { conPrefissoUnico } from './run-id'

/**
 * Supporto API per gli e2e dei ritiri programmati (4.7): anagrafiche con le loro sedi, ritiri,
 * generazione e annullo dei FIR, lettura dello stato. Tutto dentro l'azienda di test dedicata dello
 * spec (token di un suo utente): nessuna dipendenza da righe preesistenti.
 */

export interface SoggettoRitiro {
  id: string
  ragioneSociale: string
  /** Sede principale della ditta (i ritiri puntano a una sede). */
  sedeId: string
}

export interface AnagraficheRitiri {
  produttore: SoggettoRitiro
  trasportatore: SoggettoRitiro
  destinatario: SoggettoRitiro
}

export type SegmentoRegistry = 'produttori' | 'trasportatori' | 'destinatari'

export interface AnagraficaCreata {
  segmento: SegmentoRegistry
  id: string
}

export interface RitiroVisto {
  id: string
  dataPrevista: string
  ordineGiro: number | null
  stato: string
  statoVisibile: string
  motivo: string | null
  versione: number
  serieId: string | null
  fir: { id: string; numero: string | null; status: string } | null
  firPrecedenti?: Array<{ id: string }>
}

export interface EsitoGenerazione {
  ritiroId: string
  esito: 'CREATO' | 'GIA_GENERATO' | 'ERRORE'
  firId?: string
  codice?: string
}

const SEDE = {
  via: 'Via delle Prove',
  civico: '7',
  cap: '20100',
  comune: 'Milano',
  provincia: 'MI',
}

/** Produttore, trasportatore e destinatario nell'azienda del token; gli id vanno in `creati`. */
export async function creaAnagraficheRitiri(
  token: string,
  creati: AnagraficaCreata[]
): Promise<AnagraficheRitiri> {
  const crea = async (
    segmento: SegmentoRegistry,
    nome: string,
    corpo: Record<string, unknown>
  ): Promise<SoggettoRitiro> => {
    const ragioneSociale = conPrefissoUnico(nome)
    const r = await ok<{ id: string; sedeId: string }>('POST', `/registry/${segmento}`, token, {
      ragioneSociale,
      partitaIVA: partitaIvaCasualeValida(),
      ...corpo,
    })
    creati.push({ segmento, id: r.id })
    expect(r.sedeId, `sede principale di ${segmento}/${r.id}`).toBeTruthy()
    return { id: r.id, ragioneSociale, sedeId: r.sedeId }
  }
  const anno = new Date().getFullYear()
  return {
    produttore: await crea('produttori', 'Produttore ritiri', { sedeLegale: SEDE }),
    trasportatore: await crea('trasportatori', 'Trasportatore ritiri', {
      sedeLegale: SEDE,
      numeroIscrizione: `MI/${Math.floor(Math.random() * 900000 + 100000)}`,
    }),
    destinatario: await crea('destinatari', 'Destinatario ritiri', {
      sede: SEDE,
      numeroAutorizzazione: `AUT/${anno}/${Math.floor(Math.random() * 9000 + 1000)}`,
    }),
  }
}

/** Cancella le anagrafiche create, per id esatti (dopo i ritiri e i FIR che le usano). */
export async function eliminaAnagraficheRitiri(
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

export interface OpzioniRitiro {
  /** `AAAA-MM-GG`; default domani. */
  data?: string
  ordineGiro?: number
  fascia?: 'MATTINA' | 'POMERIGGIO'
  ripetizione?: { ogniGiorni?: number; ogniSettimane?: number; fino: string }
  descrizione?: string
}

/** Crea un ritiro (o la serie, con `ripetizione`) e restituisce le occorrenze create. */
export async function creaRitiri(
  token: string,
  a: AnagraficheRitiri,
  o: OpzioniRitiro = {}
): Promise<RitiroVisto[]> {
  const r = await ok<{ ritiri: RitiroVisto[] }>('POST', '/ritiri', token, {
    chiaveIdempotenza: randomUUID(),
    dataPrevista: o.data ?? giornoItaliano(1),
    fascia: o.fascia ?? null,
    ordineGiro: o.ordineGiro ?? null,
    produttoreId: a.produttore.id,
    produttoreSedeId: a.produttore.sedeId,
    trasportatoreId: a.trasportatore.id,
    destinatarioId: a.destinatario.id,
    destinatarioSedeId: a.destinatario.sedeId,
    cerCode: CER_A,
    descrizione: o.descrizione ?? 'Imballaggi in carta e cartone',
    quantitaPresunta: '120.50',
    unita: 'KG',
    codiceOperazione: 'R13',
    provenienza: 'SPECIALE',
    tipoTratta: 'TERRESTRE',
    ...(o.ripetizione ? { ripetizione: o.ripetizione } : {}),
  })
  expect(r.ritiri.length, 'ritiri creati').toBeGreaterThan(0)
  return r.ritiri
}

export const leggiRitiro = (token: string, id: string) =>
  ok<RitiroVisto>('GET', `/ritiri/${id}`, token)

/** Genera i FIR in bozza dei ritiri indicati. */
export async function generaFirRitiri(token: string, ritiroIds: string[]) {
  const r = await ok<{ esiti: EsitoGenerazione[] }>('POST', '/ritiri/genera-fir', token, {
    ritiroIds,
  })
  return r.esiti
}

/** Annulla un FIR (motivo obbligatorio): il ritiro torna «da generare». */
export async function annullaFir(token: string, firId: string): Promise<void> {
  await ok('POST', `/fir/${firId}/annulla`, token, { motivo: 'Annullato dall’e2e dei ritiri' })
}
