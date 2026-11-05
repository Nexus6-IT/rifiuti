import { Prisma } from '@prisma/client'
import { importoRiga } from '../listino/importi-riga'
import {
  applicaScaglioni,
  validaPrezzoSpeciale,
  type ApplicaPrezzoSpeciale,
} from '../listino/prezzo-speciale'
import type { ErroreDocumento, Segnalazione } from './codici'
import { famigliaCalcolata } from './costanti-fiscali'
import type { RigaDocumentoCalcolata, RigaLegameDaFatturare, RigaListinoDaFatturare } from './tipi'

/**
 * Righe del documento dai legami movimento-listino (spec §6.2 e §6.3, S10, scansione P13).
 * Dominio puro: nessun database, importi come stringhe decimali.
 */

type RigaCalcolata = Omit<RigaDocumentoCalcolata, 'numeroLinea'>

export type EsitoRighe = {
  righe: RigaCalcolata[]
  errori: Segnalazione<ErroreDocumento>[]
}

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v)

/** «<descrizione> CER <cer> del gg/mm/aaaa FIR <numero>»; senza FIR niente «FIR». */
export function descrizioneRigaMovimento(r: {
  descrizione: string | null
  cerCode: string
  dataMovimento: string
  numeroFir: string | null
}): string {
  const [aaaa, mm, gg] = r.dataMovimento.slice(0, 10).split('-')
  const parti: string[] = []
  if (r.descrizione !== null && r.descrizione.trim() !== '') parti.push(r.descrizione.trim())
  parti.push(`CER ${r.cerCode} del ${gg}/${mm}/${aaaa}`)
  if (r.numeroFir !== null && r.numeroFir.trim() !== '') parti.push(`FIR ${r.numeroFir.trim()}`)
  return parti.join(' ')
}

function confronta(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function ordinaLegami(legami: readonly RigaLegameDaFatturare[]): RigaLegameDaFatturare[] {
  return [...legami].sort(
    (a, b) =>
      confronta(a.dataMovimento, b.dataMovimento) ||
      confronta(a.legameId, b.legameId) ||
      confronta(a.rigaLegameId, b.rigaLegameId)
  )
}

/** Quantita e prezzo presenti: in un legame CONFERMATO mancano solo per un'anomalia. */
function completa(r: RigaLegameDaFatturare, conPrezzo: boolean): boolean {
  return r.quantita !== null && (!conPrezzo || r.prezzo !== null)
}

function rigaMovimentoBase(r: RigaLegameDaFatturare): RigaCalcolata {
  return {
    tipoRiga: 'MOVIMENTO',
    legameId: r.legameId,
    rigaLegameId: r.rigaLegameId,
    rigaAddebitoId: r.rigaAddebitoId,
    descrizione: descrizioneRigaMovimento(r),
    dataMovimento: r.dataMovimento,
    cerCode: r.cerCode,
    numeroFir: r.numeroFir,
    quantita: r.quantita,
    unitaMisura: r.unitaMisura,
    prezzoUnitario: '0',
    sconto: null,
    importoLordo: '0.00',
    importoSconto: '0.00',
    prezzoTotale: '0.00',
    codiceIvaId: r.codiceIvaId,
    aliquotaIva: r.aliquotaIva,
    naturaIva: r.naturaIva,
  }
}

type FasceOk = {
  righe: { descrizione: string; quantita: string; prezzo: string; sconto: string | null }[]
}

function righeFasce(
  fasce: FasceOk,
  listino: RigaListinoDaFatturare,
  legameId: string | null,
  iva: { codiceIvaId: string; aliquotaIva: string; naturaIva: string | null },
  origine: { dataMovimento: string | null }
): RigaCalcolata[] {
  return fasce.righe.map(f => {
    const i = importoRiga(f.quantita, f.prezzo, f.sconto)
    return {
      tipoRiga: 'FASCIA_SPECIALE',
      legameId,
      rigaLegameId: null,
      rigaAddebitoId: listino.id,
      descrizione: f.descrizione,
      dataMovimento: origine.dataMovimento,
      cerCode: null,
      numeroFir: null,
      quantita: f.quantita,
      unitaMisura: null,
      prezzoUnitario: f.prezzo,
      sconto: f.sconto,
      importoLordo: i.lordo,
      importoSconto: i.sconto,
      prezzoTotale: i.netto,
      ...iva,
    }
  })
}

/** Nome della regola che rende non calcolata una riga a prezzo speciale (mai un id). */
function nomeRegola(l: RigaListinoDaFatturare): string {
  if (l.condizione !== null || (l.condizioniRiferite ?? '').trim() !== '') return 'condizionata'
  return l.applicaA ?? 'prezzo speciale senza regola'
}

/**
 * Una riga `MOVIMENTO` per ogni riga di legame. A prezzo singolo porta l'importo; a prezzo speciale
 * porta quantita, UM, FIR e riferimenti con importo zero e l'importo sta nelle righe
 * `FASCIA_SPECIALE` (DOCUMENTO: con `legameId`, subito dopo la riga; PERIODO: `legameId` nullo,
 * dopo l'ultima riga `MOVIMENTO` della riga di listino). Le anomalie non fermano il calcolo delle
 * altre righe: bloccano il documento, non il calcolo.
 *
 * Nel dettaglio degli errori «<regola> riga <n>», `n` e' la posizione 1-based della riga di listino
 * nella collezione `listino` in ingresso, nell'ordine del chiamante (stessa convenzione dei Task 3 e 5).
 * L'IVA delle fasce PERIODO e' quella congelata nelle righe di legame del gruppo, che deve essere
 * univoca (altrimenti PREZZO_SPECIALE_NON_VALIDO).
 */
export function righeDaLegami(
  legami: readonly RigaLegameDaFatturare[],
  listino: ReadonlyMap<string, RigaListinoDaFatturare>
): EsitoRighe {
  const ordinati = ordinaLegami(legami)
  const errori: Segnalazione<ErroreDocumento>[] = []
  const righe: RigaCalcolata[] = []

  // Posizione 1-based della riga nel listino in ingresso (ordine del chiamante): il dettaglio degli
  // errori non cita mai id.
  const numeroListino = new Map<string, number>()
  let posizione = 0
  for (const id of listino.keys()) numeroListino.set(id, ++posizione)

  // Esito per riga di listino a prezzo speciale: scartata (con errore gia' registrato) o ammessa.
  const scartate = new Set<string>()
  const gruppiPeriodo = new Map<string, RigaLegameDaFatturare[]>()
  const ultimoDelGruppo = new Map<string, string>()
  const speciali = new Map<string, RigaListinoDaFatturare>()

  for (const r of ordinati) {
    if (!r.prezzoSpeciale || scartate.has(r.rigaAddebitoId) || speciali.has(r.rigaAddebitoId))
      continue
    const l = listino.get(r.rigaAddebitoId)
    if (!l) {
      scartate.add(r.rigaAddebitoId)
      errori.push({
        codice: 'PREZZO_SPECIALE_NON_VALIDO',
        dettaglio: 'riga di listino assente',
      })
      continue
    }
    if (!famigliaCalcolata({ ...l, tipo: r.tipo, prezzoSpeciale: true })) {
      scartate.add(r.rigaAddebitoId)
      const n = numeroListino.get(r.rigaAddebitoId)
      errori.push({ codice: 'FAMIGLIA_NON_CALCOLATA', dettaglio: `${nomeRegola(l)} riga ${n}` })
      continue
    }
    const messaggi = validaPrezzoSpeciale(
      {
        applicaA: l.applicaA as ApplicaPrezzoSpeciale | null,
        condizioniRiferite: l.condizioniRiferite,
        unitaMisura: l.unitaMisura,
        riferimentoGiorno: null,
        riferimentoMese: null,
        condizione: l.condizione,
        sconto: l.sconto,
        provvigione: null,
        minimoFatturabile: l.minimoFatturabile,
        // La provvigione non entra nella fattura: il tipo serve solo a non rifiutare le fasce che la portano.
        tipoProvvigione: 'SCONTATO',
      },
      l.scaglioni
    )
    if (messaggi.length > 0) {
      scartate.add(r.rigaAddebitoId)
      errori.push({
        codice: 'PREZZO_SPECIALE_NON_VALIDO',
        dettaglio: `${messaggi[0]} riga ${numeroListino.get(r.rigaAddebitoId)}`,
      })
      continue
    }
    speciali.set(r.rigaAddebitoId, l)
  }

  // Raggruppamento PERIODO e controllo della UM.
  for (const r of ordinati) {
    const l = speciali.get(r.rigaAddebitoId)
    if (!l || l.applicaA !== 'PERIODO') continue
    if (completa(r, false)) {
      ultimoDelGruppo.set(r.rigaAddebitoId, r.rigaLegameId)
      const g = gruppiPeriodo.get(r.rigaAddebitoId) ?? []
      g.push(r)
      gruppiPeriodo.set(r.rigaAddebitoId, g)
    }
  }
  /** Fasce gia' calcolate del gruppo PERIODO; `null` = gruppo non calcolabile. */
  const fascePeriodo = new Map<string, RigaCalcolata[]>()
  for (const [id, gruppo] of gruppiPeriodo) {
    const n = numeroListino.get(id) as number
    const l = speciali.get(id) as RigaListinoDaFatturare
    const um = new Set(gruppo.map(r => r.unitaMisura))
    if (um.size > 1) {
      scartate.add(id)
      errori.push({ codice: 'UM_NON_UNIVOCA', dettaglio: `riga ${n}` })
      continue
    }
    if (new Set(gruppo.map(r => r.codiceIvaId)).size > 1) {
      scartate.add(id)
      errori.push({
        codice: 'PREZZO_SPECIALE_NON_VALIDO',
        dettaglio: `codice IVA non univoco riga ${n}`,
      })
      continue
    }
    const somma = gruppo.reduce((s, r) => s.plus(D(r.quantita as string)), new Prisma.Decimal(0))
    const esito = applicaScaglioni(l.scaglioni, somma.toFixed(), gruppo[0].unitaMisura)
    if ('errore' in esito) {
      scartate.add(id)
      errori.push({ codice: 'PREZZO_SPECIALE_NON_VALIDO', dettaglio: `${esito.errore} riga ${n}` })
      continue
    }
    fascePeriodo.set(
      id,
      righeFasce(
        esito,
        l,
        null,
        {
          codiceIvaId: gruppo[0].codiceIvaId,
          aliquotaIva: gruppo[0].aliquotaIva,
          naturaIva: gruppo[0].naturaIva,
        },
        { dataMovimento: null }
      )
    )
  }

  for (const r of ordinati) {
    if (scartate.has(r.rigaAddebitoId) && r.prezzoSpeciale) continue

    if (!r.prezzoSpeciale) {
      if (!completa(r, true)) {
        errori.push({ codice: 'RIGA_LEGAME_INCOMPLETA' })
        continue
      }
      const i = importoRiga(r.quantita as string, r.prezzo as string, r.sconto)
      righe.push({
        ...rigaMovimentoBase(r),
        prezzoUnitario: r.prezzo as string,
        sconto: r.sconto,
        importoLordo: i.lordo,
        importoSconto: i.sconto,
        prezzoTotale: i.netto,
      })
      continue
    }

    if (!completa(r, false)) {
      errori.push({ codice: 'RIGA_LEGAME_INCOMPLETA' })
      continue
    }
    const l = speciali.get(r.rigaAddebitoId) as RigaListinoDaFatturare
    const esitoDocumento =
      l.applicaA === 'DOCUMENTO'
        ? applicaScaglioni(l.scaglioni, r.quantita as string, r.unitaMisura)
        : null
    if (esitoDocumento && 'errore' in esitoDocumento) {
      errori.push({
        codice: 'PREZZO_SPECIALE_NON_VALIDO',
        dettaglio: `${esitoDocumento.errore} riga ${numeroListino.get(r.rigaAddebitoId)}`,
      })
      continue
    }
    righe.push(rigaMovimentoBase(r))

    if (esitoDocumento) {
      const esito = esitoDocumento
      righe.push(
        ...righeFasce(
          esito,
          l,
          r.legameId,
          {
            codiceIvaId: r.codiceIvaId,
            aliquotaIva: r.aliquotaIva,
            naturaIva: r.naturaIva,
          },
          { dataMovimento: r.dataMovimento }
        )
      )
    } else if (ultimoDelGruppo.get(r.rigaAddebitoId) === r.rigaLegameId) {
      righe.push(...(fascePeriodo.get(r.rigaAddebitoId) ?? []))
    }
  }

  return { righe, errori }
}
